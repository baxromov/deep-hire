import asyncio
import hashlib
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from app.config import settings
from app.database import get_qdrant
from app.models.vacancy import VacancyStatus
from app.services import ai_service, candidate_service, file_service, hh_service, vacancy_service
from app.services.embedding_service import build_vacancy_text, embed
from app.services.hh_service import title_score
from app.services.qdrant_service import collection_info, search_candidates

router = APIRouter(prefix="/api/matching", tags=["matching"])
logger = logging.getLogger(__name__)

MAX_PAGES = 40         # max pages per search variant (40 × 50 = 2 000 — HH limit)
PER_PAGE = 50          # results per HH page
CONCURRENCY = 5        # parallel HH detail-fetch requests
SCORE_CONCURRENCY = 10 # parallel Ollama scoring calls
PRE_FILTER_THRESHOLD = 0.2  # min title keyword overlap before sending to Ollama

# Read thresholds from settings (tunable via env vars)
MIN_SCORE: int = settings.match_min_score
TOP_N: int = settings.match_top_n


def _make_scorer(vacancy, sem: asyncio.Semaphore):
    """Return an async scoring function bound to a vacancy and semaphore."""
    async def _score(resume: dict) -> tuple[dict, int]:
        async with sem:
            skills = [
                s if isinstance(s, str) else s.get("name", "")
                for s in (resume.get("skill_set") or [])
            ]
            score = await ai_service.score_candidate(
                vacancy_title=vacancy.title or "",
                vacancy_description=vacancy.description or "",
                required_skills=vacancy.skills,
                experience=vacancy.experience or "",
                candidate_title=resume.get("title", ""),
                candidate_skills=skills,
            )
        return resume, score
    return _score


async def _fetch_and_resolve(items: list[dict]) -> list[dict]:
    """Fetch full resume details, fall back to summary on failure."""
    ids = [r["id"] for r in items if r.get("id")]
    if not ids:
        return []
    details = await hh_service.get_resume_details_bulk(ids, concurrency=CONCURRENCY)
    id_to_summary = {r["id"]: r for r in items if r.get("id")}
    return [
        (detail if detail else id_to_summary.get(rid, {}))
        for rid, detail in zip(ids, details)
        if detail or id_to_summary.get(rid)
    ]


async def rematch(vacancy_id: str):
    vacancy = await vacancy_service.get_vacancy(vacancy_id)
    if not vacancy:
        raise HTTPException(status_code=404, detail="Vacancy not found")
    if vacancy.status != VacancyStatus.approved:
        raise HTTPException(status_code=422, detail="Vacancy must be approved to rematch")

    if not vacancy.title:
        return {"matched": 0, "total": 0, "last_matched_at": vacancy.last_matched_at}

    # Build search variants: prefer AI-generated semantic queries, fall back to mechanical
    ai_queries = await ai_service.generate_search_queries(
        vacancy.title, vacancy.description or "", vacancy.skills
    )
    if ai_queries:
        variants = hh_service.build_search_variants(ai_queries)
        logger.info("rematch: AI queries %s", ai_queries)
    else:
        variants = hh_service.get_title_variants(vacancy.title)
        logger.info("rematch: AI query generation failed, using mechanical variants")

    sem = asyncio.Semaphore(SCORE_CONCURRENCY)
    score_resume = _make_scorer(vacancy, sem)
    collected: list[tuple[dict, int]] = []
    seen_ids: set[str] = set()

    for text, logic, field in variants:
        if len(collected) >= TOP_N:
            break

        for page in range(MAX_PAGES):
            if len(collected) >= TOP_N:
                break

            items, total_pages = await hh_service.search_resumes_page(
                vacancy, page, text, logic, field, PER_PAGE
            )
            if not items:
                break

            resolved = await _fetch_and_resolve(items)
            if not resolved:
                break

            # Deduplication: skip already-scored resumes
            resolved = [r for r in resolved if r.get("id") not in seen_ids]
            seen_ids.update(r.get("id", "") for r in resolved)

            # Pre-filter by title keyword overlap before expensive Ollama call
            pre_filtered = [
                r for r in resolved
                if title_score(r.get("title", ""), vacancy.title or "") >= PRE_FILTER_THRESHOLD
            ]
            to_score = pre_filtered if pre_filtered else resolved

            scored: list[tuple[dict, int]] = list(
                await asyncio.gather(*[score_resume(r) for r in to_score])
            )
            good = [(r, s) for r, s in scored if s >= MIN_SCORE]
            top_score = max((s for _, s in scored), default=0)

            logger.info(
                "rematch: variant=%r page=%d fetched=%d pre_filtered=%d scored=%d qualifying=%d top=%d",
                text, page, len(resolved), len(to_score), len(scored), len(good), top_score,
            )
            collected.extend(good)

            # If page 0 of this variant yields nothing, switch to next variant
            if page == 0 and not good:
                logger.info("rematch: 0 qualify on page 0 of %r — trying next variant", text)
                break

            if page + 1 >= total_pages:
                break

    collected.sort(key=lambda x: x[1], reverse=True)
    top = collected[:TOP_N]
    count = await candidate_service.replace_candidates(vacancy, top)
    vacancy.last_matched_at = datetime.now(timezone.utc)
    await vacancy.save()

    logger.info("rematch: saved %d/%d qualifying for vacancy %s", count, len(collected), vacancy_id)
    return {"matched": count, "total": count, "last_matched_at": vacancy.last_matched_at}


async def rematch_status(vacancy_id: str):
    vacancy = await vacancy_service.get_vacancy(vacancy_id)
    if not vacancy:
        raise HTTPException(status_code=404, detail="Vacancy not found")
    candidates = await candidate_service.get_candidates_for_vacancy(vacancy_id)
    return {
        "last_matched_at": vacancy.last_matched_at,
        "total_candidates": len(candidates),
        "can_rematch": vacancy.status == VacancyStatus.approved,
    }


async def match_from_file(vacancy_id: str, file: UploadFile = File(...)):
    """Upload a resume file, extract candidate info, score against vacancy, save as candidate."""
    vacancy = await vacancy_service.get_vacancy(vacancy_id)
    if not vacancy:
        raise HTTPException(status_code=404, detail="Vacancy not found")
    if vacancy.status != VacancyStatus.approved:
        raise HTTPException(status_code=422, detail="Vacancy must be approved to match candidates")

    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    file_bytes = await file.read()
    if len(file_bytes) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (max 10 MB)")

    # Extract text from PDF/DOCX
    text = file_service.extract_text(file.filename, file_bytes)
    if not text:
        raise HTTPException(status_code=422, detail="Could not extract text from file")

    # Extract fields first, then score once with actual data
    fields = await ai_service.extract_resume_fields(text)
    score = await ai_service.score_candidate(
        vacancy_title=vacancy.title or "",
        required_skills=vacancy.skills,
        experience=vacancy.experience or "",
        candidate_title=fields.get("title", ""),
        candidate_skills=fields.get("skills", []),
        vacancy_description=vacancy.description or "",
    )

    # Use file hash as a stable unique ID
    file_hash = hashlib.md5(file_bytes).hexdigest()[:16]

    from app.models.candidate import Candidate
    from beanie import PydanticObjectId

    # Remove existing candidate with same file hash for this vacancy (re-upload)
    await Candidate.find({
        "vacancy_id": vacancy.id,
        "hh_resume_id": f"file:{file_hash}",
    }).delete()

    candidate = Candidate(
        vacancy_id=vacancy.id,
        hh_resume_id=f"file:{file_hash}",
        first_name=fields.get("first_name"),
        last_name=fields.get("last_name"),
        title=fields.get("title"),
        area=fields.get("area"),
        salary_amount=fields.get("salary_amount"),
        salary_currency=fields.get("salary_currency"),
        skills=fields.get("skills", []),
        relevance_score=score,
        raw_resume_json={"source": "file", "filename": file.filename, "extracted": fields},
        matched_at=datetime.now(timezone.utc),
    )
    await candidate.insert()

    logger.info("match_from_file: saved candidate score=%d for vacancy %s", score, vacancy_id)
    return {
        "id": str(candidate.id),
        "name": " ".join(filter(None, [fields.get("first_name"), fields.get("last_name")])) or fields.get("title") or "Unknown",
        "score": score,
    }


async def rematch_stream(vacancy_id: str):
    """SSE endpoint — streams per-step progress of the smart rematch to the browser."""

    async def event_stream():
        queue: asyncio.Queue[dict | None] = asyncio.Queue()

        async def emit(event: dict) -> None:
            await queue.put(event)

        async def run() -> None:
            try:
                vacancy = await vacancy_service.get_vacancy(vacancy_id)
                if not vacancy:
                    await emit({"step": "error", "message": "Vacancy not found."})
                    return
                if vacancy.status != VacancyStatus.approved:
                    await emit({"step": "error", "message": "Vacancy must be approved to rematch."})
                    return
                if not vacancy.title:
                    await emit({"step": "error", "message": "Vacancy has no title."})
                    return

                # Ask AI to generate smart, semantically varied search queries
                await emit({
                    "step": "planning",
                    "message": "Generating smart search queries from vacancy description...",
                })
                ai_queries = await ai_service.generate_search_queries(
                    vacancy.title, vacancy.description or "", vacancy.skills
                )
                if ai_queries:
                    variants = hh_service.build_search_variants(ai_queries)
                    await emit({
                        "step": "queries_ready",
                        "queries": ai_queries,
                        "message": "Search plan: " + "  →  ".join(f'\"{q}\"' for q in ai_queries),
                    })
                else:
                    variants = hh_service.get_title_variants(vacancy.title)
                    await emit({
                        "step": "queries_ready",
                        "queries": [t for t, _, _ in variants],
                        "message": "Using title-based search: " + "  →  ".join(f'\"{t}\"' for t, _, _ in variants),
                    })

                sem = asyncio.Semaphore(SCORE_CONCURRENCY)
                score_resume = _make_scorer(vacancy, sem)
                collected: list[tuple[dict, int]] = []
                seen_ids: set[str] = set()

                # ---------- variant loop ----------

                for var_idx, (text, logic, field) in enumerate(variants):
                    if len(collected) >= TOP_N:
                        break

                    if var_idx == 0:
                        await emit({
                            "step": "searching",
                            "message": f"Searching HH.ru: \"{text}\"...",
                        })
                    else:
                        await emit({
                            "step": "new_search",
                            "message": f"Trying next query: \"{text}\"...",
                        })

                    variant_has_results = False

                    for page in range(MAX_PAGES):
                        if len(collected) >= TOP_N:
                            break

                        items, total_pages = await hh_service.search_resumes_page(
                            vacancy, page, text, logic, field, PER_PAGE
                        )
                        if not items:
                            if not variant_has_results:
                                await emit({
                                    "step": "no_results",
                                    "message": f"No results for \"{text}\".",
                                })
                            break

                        variant_has_results = True

                        # Fetch details
                        await emit({
                            "step": "fetching",
                            "page": page + 1,
                            "count": len(items),
                            "message": f"Page {page + 1}: fetching details for {len(items)} resumes...",
                        })
                        resolved = await _fetch_and_resolve(items)
                        if not resolved:
                            break

                        # Deduplication + pre-filter
                        resolved = [r for r in resolved if r.get("id") not in seen_ids]
                        seen_ids.update(r.get("id", "") for r in resolved)
                        pre_filtered = [
                            r for r in resolved
                            if title_score(r.get("title", ""), vacancy.title or "") >= PRE_FILTER_THRESHOLD
                        ]
                        to_score = pre_filtered if pre_filtered else resolved

                        # Score (rate-limited)
                        await emit({
                            "step": "scoring",
                            "page": page + 1,
                            "total": len(to_score),
                            "message": f"Page {page + 1}: AI scoring {len(to_score)}/{len(resolved)} candidates...",
                        })
                        scored: list[tuple[dict, int]] = list(
                            await asyncio.gather(*[score_resume(r) for r in to_score])
                        )
                        good = [(r, s) for r, s in scored if s >= MIN_SCORE]
                        top_score = max((s for _, s in scored), default=0)

                        await emit({
                            "step": "filtered",
                            "page": page + 1,
                            "passed": len(good),
                            "total": len(scored),
                            "top_score": top_score,
                            "message": (
                                f"Page {page + 1}: {len(good)}/{len(scored)} passed ≥{MIN_SCORE}%"
                                f"  (top score: {top_score}%)"
                            ),
                        })

                        collected.extend(good)

                        # Page 0 had 0 qualifying → switch to next variant
                        if page == 0 and not good:
                            await emit({
                                "step": "switch_search",
                                "message": (
                                    f"0 candidates qualified (top score {top_score}%) — "
                                    "trying different search terms..."
                                ),
                            })
                            break

                        # Early stop within this variant
                        if len(collected) >= TOP_N:
                            await emit({
                                "step": "early_stop",
                                "collected": len(collected),
                                "message": f"Found {len(collected)} qualifying candidates — stopping.",
                            })
                            break

                        # No more pages
                        if page + 1 >= total_pages:
                            break

                        await emit({
                            "step": "next_page",
                            "page": page + 2,
                            "collected": len(collected),
                            "needed": max(0, TOP_N - len(collected)),
                            "message": (
                                f"Need {max(0, TOP_N - len(collected))} more — "
                                f"checking page {page + 2}..."
                            ),
                        })

                # ---------- save & finish ----------

                collected.sort(key=lambda x: x[1], reverse=True)
                top = collected[:TOP_N]
                count = await candidate_service.replace_candidates(vacancy, top)
                vacancy.last_matched_at = datetime.now(timezone.utc)
                await vacancy.save()

                if count:
                    await emit({
                        "step": "done",
                        "matched": count,
                        "qualifying": len(collected),
                        "message": (
                            f"Done! Saved {count} candidates "
                            f"(from {len(collected)} qualifying ≥{MIN_SCORE}%)."
                        ),
                    })
                else:
                    await emit({
                        "step": "done",
                        "matched": 0,
                        "qualifying": 0,
                        "message": (
                            f"No candidates scored ≥{MIN_SCORE}% across all search variants. "
                            "Try adjusting vacancy skills or description."
                        ),
                    })

            except Exception as exc:
                logger.error("rematch_stream error: %s", exc)
                await emit({"step": "error", "message": f"Rematch failed: {exc}"})
            finally:
                await queue.put(None)  # sentinel — tells the generator to stop

        asyncio.create_task(run())

        while True:
            event = await queue.get()
            if event is None:
                break
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # disables nginx response buffering
        },
    )


async def match_from_pool(vacancy_id: str):
    """
    Approach B — search the pre-indexed Uzbek talent pool in Qdrant,
    re-score top results with Ollama, save the best candidates to MongoDB.
    """
    vacancy = await vacancy_service.get_vacancy(vacancy_id)
    if not vacancy:
        raise HTTPException(status_code=404, detail="Vacancy not found")
    if vacancy.status != VacancyStatus.approved:
        raise HTTPException(status_code=422, detail="Vacancy must be approved to match candidates")

    qdrant = await get_qdrant()
    pool = await collection_info(qdrant)
    if pool["points_count"] == 0:
        raise HTTPException(
            status_code=422,
            detail="Talent pool is empty — run POST /api/talent-pool/ingest first",
        )

    # Embed the vacancy
    vacancy_text = build_vacancy_text(vacancy)
    query_vector = await embed(vacancy_text)

    # Retrieve top-K from Qdrant
    pool_hits = await search_candidates(
        qdrant,
        query_vector,
        top_k=settings.pool_top_k,
        area_filter=vacancy.area or None,
        min_salary=vacancy.salary_from,
        max_salary=vacancy.salary_to,
    )

    if not pool_hits:
        return {"matched": 0, "total": 0, "last_matched_at": vacancy.last_matched_at}

    resumes_to_score = [
        hit["raw_resume_json"]
        for hit in pool_hits[:settings.pool_rescore_n]
        if hit.get("raw_resume_json")
    ]

    sem = asyncio.Semaphore(SCORE_CONCURRENCY)
    score_resume = _make_scorer(vacancy, sem)
    scored: list[tuple[dict, int]] = list(
        await asyncio.gather(*[score_resume(r) for r in resumes_to_score])
    )
    good = [(r, s) for r, s in scored if s >= MIN_SCORE]
    good.sort(key=lambda x: x[1], reverse=True)
    top = good[:settings.pool_top_n]

    # Tag each resume with source before saving
    tagged = [({**r, "_source": "talent_pool"}, s) for r, s in top]
    count = await candidate_service.replace_candidates(vacancy, tagged)
    vacancy.last_matched_at = datetime.now(timezone.utc)
    await vacancy.save()

    logger.info("match_from_pool: saved %d candidates for vacancy %s", count, vacancy_id)
    return {"matched": count, "total": count, "last_matched_at": vacancy.last_matched_at}


async def match_from_pool_stream(vacancy_id: str):
    """SSE streaming version of match-from-pool."""

    async def event_stream():
        queue: asyncio.Queue[dict | None] = asyncio.Queue()

        async def emit(event: dict) -> None:
            await queue.put(event)

        async def run() -> None:
            try:
                vacancy = await vacancy_service.get_vacancy(vacancy_id)
                if not vacancy:
                    await emit({"step": "error", "message": "Vacancy not found."})
                    return
                if vacancy.status != VacancyStatus.approved:
                    await emit({"step": "error", "message": "Vacancy must be approved."})
                    return

                qdrant = await get_qdrant()
                pool = await collection_info(qdrant)
                if pool["points_count"] == 0:
                    await emit({
                        "step": "error",
                        "message": "Talent pool is empty. Run ingestion first.",
                    })
                    return

                await emit({
                    "step": "embedding",
                    "message": f"Embedding vacancy into vector space... (pool size: {pool['points_count']})",
                })
                vacancy_text = build_vacancy_text(vacancy)
                query_vector = await embed(vacancy_text)

                await emit({
                    "step": "searching",
                    "message": f"Searching Qdrant talent pool for top {settings.pool_top_k} candidates...",
                })
                pool_hits = await search_candidates(
                    qdrant,
                    query_vector,
                    top_k=settings.pool_top_k,
                    area_filter=vacancy.area or None,
                    min_salary=vacancy.salary_from,
                    max_salary=vacancy.salary_to,
                )

                if not pool_hits:
                    await emit({
                        "step": "done",
                        "matched": 0,
                        "message": "No candidates found in talent pool matching these filters.",
                    })
                    return

                await emit({
                    "step": "fetched",
                    "count": len(pool_hits),
                    "message": f"Retrieved {len(pool_hits)} candidates from pool — re-scoring with AI...",
                })

                resumes_to_score = [
                    hit["raw_resume_json"]
                    for hit in pool_hits[:settings.pool_rescore_n]
                    if hit.get("raw_resume_json")
                ]

                sem = asyncio.Semaphore(SCORE_CONCURRENCY)
                score_resume = _make_scorer(vacancy, sem)

                await emit({
                    "step": "scoring",
                    "total": len(resumes_to_score),
                    "message": f"AI scoring {len(resumes_to_score)} candidates...",
                })
                scored: list[tuple[dict, int]] = list(
                    await asyncio.gather(*[score_resume(r) for r in resumes_to_score])
                )
                good = [(r, s) for r, s in scored if s >= MIN_SCORE]
                good.sort(key=lambda x: x[1], reverse=True)
                top_score = max((s for _, s in scored), default=0)

                await emit({
                    "step": "filtered",
                    "passed": len(good),
                    "total": len(scored),
                    "top_score": top_score,
                    "message": (
                        f"{len(good)}/{len(scored)} candidates passed ≥{MIN_SCORE}% threshold"
                        f"  (top score: {top_score}%)"
                    ),
                })

                top = good[:settings.pool_top_n]
                tagged = [({**r, "_source": "talent_pool"}, s) for r, s in top]
                count = await candidate_service.replace_candidates(vacancy, tagged)
                vacancy.last_matched_at = datetime.now(timezone.utc)
                await vacancy.save()

                await emit({
                    "step": "done",
                    "matched": count,
                    "qualifying": len(good),
                    "message": (
                        f"Done! Saved {count} candidates from the Uzbek talent pool "
                        f"(from {len(good)} qualifying ≥{MIN_SCORE}%)."
                    ),
                })

            except Exception as exc:
                logger.error("match_from_pool_stream error: %s", exc)
                await emit({"step": "error", "message": f"Pool match failed: {exc}"})
            finally:
                await queue.put(None)

        asyncio.create_task(run())

        while True:
            event = await queue.get()
            if event is None:
                break
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


router.add_api_route("/vacancies/{vacancy_id}/rematch", rematch, methods=["POST"])
router.add_api_route("/vacancies/{vacancy_id}/rematch-stream", rematch_stream, methods=["GET"])
router.add_api_route("/vacancies/{vacancy_id}/status", rematch_status, methods=["GET"])
router.add_api_route("/vacancies/{vacancy_id}/match-from-file", match_from_file, methods=["POST"])
router.add_api_route("/vacancies/{vacancy_id}/match-from-pool", match_from_pool, methods=["POST"])
router.add_api_route("/vacancies/{vacancy_id}/match-from-pool-stream", match_from_pool_stream, methods=["GET"])
