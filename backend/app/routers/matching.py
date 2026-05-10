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
from app.services.embedding_service import build_resume_text, build_vacancy_text, embed, embed_batch
from app.services.ingestion_service import _fetch_resume_page
from app.services.qdrant_service import (
    collection_info,
    search_candidates,
    ensure_temp_collection,
    upsert_to_temp_collection,
    search_temp_collection,
    search_temp_collection_scored,
    delete_temp_collection,
)

router = APIRouter(prefix="/api/matching", tags=["matching"])
logger = logging.getLogger(__name__)

MAX_PAGES = settings.hh_max_search_pages  # Problem 6: hard cap (default 3 pages)
PER_PAGE = 50          # results per HH page
CONCURRENCY = 5        # parallel HH detail-fetch requests
SCORE_CONCURRENCY = 10 # parallel Ollama scoring calls
REMATCH_TOP_N = 50     # top candidates saved after vector reranking

# Read thresholds from settings (tunable via env vars — used by pool flows)
MIN_SCORE: int = settings.match_min_score
TOP_N: int = settings.match_top_n

LIVE_POOL_PAGES: int = settings.live_pool_pages
LIVE_POOL_PER_PAGE: int = settings.live_pool_per_page


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


async def _fetch_and_resolve(items: list[dict]) -> tuple[list[dict], int]:
    """Fetch full resume details, fall back to summary on failure.

    Returns (resolved_resumes, rate_limited_count).
    """
    ids = [r["id"] for r in items if r.get("id")]
    if not ids:
        return [], 0
    details, rate_limited = await hh_service.get_resume_details_bulk(ids, concurrency=CONCURRENCY)
    id_to_summary = {r["id"]: r for r in items if r.get("id")}
    resolved = [
        (detail if detail else id_to_summary.get(rid, {}))
        for rid, detail in zip(ids, details)
        if detail or id_to_summary.get(rid)
    ]
    return resolved, rate_limited


async def rematch(vacancy_id: str):
    vacancy = await vacancy_service.get_vacancy(vacancy_id)
    if not vacancy:
        raise HTTPException(status_code=404, detail="Vacancy not found")
    if vacancy.status != VacancyStatus.approved:
        raise HTTPException(status_code=422, detail="Vacancy must be approved to rematch")

    if not vacancy.title:
        return {"matched": 0, "total": 0, "last_matched_at": vacancy.last_matched_at}

    ai_queries = await ai_service.generate_search_queries(
        vacancy.title, vacancy.description or "", vacancy.skills
    )
    if ai_queries:
        variants = hh_service.build_search_variants(ai_queries)
        logger.info("rematch: AI queries %s", ai_queries)
    else:
        variants = hh_service.get_title_variants(vacancy.title)
        logger.info("rematch: AI query generation failed, using mechanical variants")

    # Phase 1 — Collect all resumes from HH across all variants and pages
    all_resumes: list[dict] = []
    seen_ids: set[str] = set()
    for text, logic, field in variants:
        for page in range(MAX_PAGES):
            items, total_pages = await hh_service.search_resumes_page(
                vacancy, page, text, logic, field, PER_PAGE
            )
            if not items:
                break
            resolved, _rl = await _fetch_and_resolve(items)
            resolved = [r for r in resolved if r.get("id") not in seen_ids]
            seen_ids.update(r.get("id", "") for r in resolved)
            all_resumes.extend(resolved)
            logger.info("rematch: variant=%r page=%d fetched=%d total_so_far=%d", text, page, len(resolved), len(all_resumes))
            if page + 1 >= total_pages:
                break

    if not all_resumes:
        return {"matched": 0, "total": 0, "last_matched_at": vacancy.last_matched_at}

    # Phase 2 — Embed all resumes and upsert to a temporary Qdrant collection
    qdrant = await get_qdrant()
    tmp_collection = f"tmp_rematch_{vacancy_id}"
    await ensure_temp_collection(qdrant, tmp_collection)

    try:
        texts = [build_resume_text(r) for r in all_resumes]
        vectors = await embed_batch(texts)
        await upsert_to_temp_collection(qdrant, tmp_collection, all_resumes, vectors)
        logger.info("rematch: indexed %d resumes into temp collection", len(all_resumes))

        # Phase 3 — Vector search → top REMATCH_TOP_N by cosine similarity
        vacancy_text = build_vacancy_text(vacancy)
        query_vector = await embed(vacancy_text)
        hits = await search_temp_collection_scored(
            qdrant, tmp_collection, query_vector, top_k=REMATCH_TOP_N
        )

        top = [
            ({**payload["raw_resume_json"], "_source": "hh_search"}, int(score * 100))
            for payload, score in hits
            if payload.get("raw_resume_json")
        ]
    finally:
        await delete_temp_collection(qdrant, tmp_collection)

    count = await candidate_service.replace_candidates(vacancy, top)
    vacancy.last_matched_at = datetime.now(timezone.utc)
    await vacancy.save()

    logger.info("rematch: saved %d top candidates from %d total for vacancy %s", count, len(all_resumes), vacancy_id)
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

                all_resumes: list[dict] = []
                seen_ids: set[str] = set()

                # ---------- Phase 1: collect all resumes ----------

                for var_idx, (text, logic, field) in enumerate(variants):
                    if var_idx == 0:
                        await emit({"step": "searching", "message": f"Searching HH.uz: \"{text}\"..."})
                    else:
                        await emit({"step": "new_search", "message": f"Trying next query: \"{text}\"..."})

                    variant_has_results = False
                    for page in range(MAX_PAGES):
                        items, total_pages = await hh_service.search_resumes_page(
                            vacancy, page, text, logic, field, PER_PAGE
                        )
                        if not items:
                            if not variant_has_results:
                                await emit({"step": "no_results", "message": f"No results for \"{text}\"."})
                            break

                        variant_has_results = True
                        await emit({
                            "step": "fetching",
                            "page": page + 1,
                            "count": len(items),
                            "message": f"Page {page + 1}: fetching details for {len(items)} resumes...",
                        })
                        resolved, rate_limited = await _fetch_and_resolve(items)
                        if rate_limited:
                            await emit({
                                "step": "rate_limit",
                                "message": f"hh.uz rate limited {rate_limited} request(s) — some resumes skipped.",
                            })
                        if not resolved:
                            break

                        resolved = [r for r in resolved if r.get("id") not in seen_ids]
                        seen_ids.update(r.get("id", "") for r in resolved)
                        all_resumes.extend(resolved)

                        await emit({
                            "step": "collected",
                            "page": page + 1,
                            "added": len(resolved),
                            "total": len(all_resumes),
                            "message": f"Page {page + 1}: collected {len(resolved)} new resumes (total: {len(all_resumes)}).",
                        })

                        if page + 1 >= total_pages:
                            break

                if not all_resumes:
                    await emit({"step": "done", "matched": 0, "message": "No candidates found across all search queries."})
                    return

                # ---------- Phase 2: embed → temp Qdrant collection ----------

                await emit({
                    "step": "embedding",
                    "total": len(all_resumes),
                    "message": f"Embedding {len(all_resumes)} resumes into temporary vector index...",
                })
                qdrant = await get_qdrant()
                tmp_collection = f"tmp_rematch_{vacancy_id}"
                await ensure_temp_collection(qdrant, tmp_collection)

                try:
                    texts = [build_resume_text(r) for r in all_resumes]
                    vectors = await embed_batch(texts)
                    upserted = await upsert_to_temp_collection(qdrant, tmp_collection, all_resumes, vectors)
                    await emit({
                        "step": "indexed",
                        "count": upserted,
                        "message": f"Indexed {upserted} candidates into temporary vector store.",
                    })

                    # ---------- Phase 3: vector search → top 50 ----------

                    await emit({
                        "step": "vector_search",
                        "message": f"Vector searching for top {REMATCH_TOP_N} candidates by cosine similarity...",
                    })
                    vacancy_text = build_vacancy_text(vacancy)
                    query_vector = await embed(vacancy_text)
                    hits = await search_temp_collection_scored(
                        qdrant, tmp_collection, query_vector, top_k=REMATCH_TOP_N
                    )

                    top = [
                        ({**payload["raw_resume_json"], "_source": "hh_search"}, int(score * 100))
                        for payload, score in hits
                        if payload.get("raw_resume_json")
                    ]
                finally:
                    await delete_temp_collection(qdrant, tmp_collection)
                    await emit({"step": "cleanup", "message": f"Temporary vector index deleted."})

                # ---------- save & finish ----------

                count = await candidate_service.replace_candidates(vacancy, top)
                vacancy.last_matched_at = datetime.now(timezone.utc)
                await vacancy.save()

                await emit({
                    "step": "done",
                    "matched": count,
                    "total_collected": len(all_resumes),
                    "message": f"Done! Saved top {count} candidates (from {len(all_resumes)} collected, ranked by vector similarity).",
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
    Approach B — search the pre-indexed talent pool in Qdrant,
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

                # Search plan summary
                filters = []
                if vacancy.area:
                    filters.append(f"area: {vacancy.area}")
                if vacancy.salary_from:
                    filters.append(f"salary ≥ {vacancy.salary_from:,}")
                if vacancy.salary_to:
                    filters.append(f"salary ≤ {vacancy.salary_to:,}")
                plan_lines = [
                    f"Pool: {pool['points_count']:,} indexed candidates",
                    f"Step 1 → embed vacancy → cosine similarity search (top {settings.pool_top_k})",
                    f"Step 2 → re-score top {settings.pool_rescore_n} with Ollama LLM",
                    f"Step 3 → save top {settings.pool_top_n} with score ≥{MIN_SCORE}% to MongoDB",
                ]
                if filters:
                    plan_lines.insert(1, "Filters: " + ", ".join(filters))
                await emit({
                    "step": "queries_ready",
                    "queries": plan_lines,
                    "message": "Search plan: " + "  →  ".join([
                        f"{pool['points_count']:,} candidates",
                        f"top {settings.pool_top_k} by vector",
                        f"re-score {settings.pool_rescore_n}",
                        f"save top {settings.pool_top_n}",
                    ]),
                })

                await emit({
                    "step": "embedding",
                    "message": f"Embedding vacancy into vector space... (pool: {pool['points_count']:,})",
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
                        f"Done! Saved {count} candidates from the talent pool "
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


async def _run_live_pool_pipeline(vacancy, emit) -> tuple[int, int]:
    """
    Core pipeline for live-pool matching. Fetches 2000 HH candidates into a
    temporary Qdrant collection, vector-searches with threshold 0.85, Ollama
    re-scores the top 30, saves qualifying top-10 to MongoDB, then deletes
    the temp collection.

    emit: async callable(dict) -> None for progress events (no-op for sync callers).
    Returns (saved_count, qualifying_count).
    """
    import httpx
    from app.services.hh_service import get_valid_token, _build_headers
    from app.services.embedding_service import build_resume_text

    qdrant = await get_qdrant()
    vacancy_id = str(vacancy.id)
    tmp_collection = f"tmp_{vacancy_id}"

    # Step 1 — LLM extracts skills → query vector
    await emit({"step": "extracting_skills", "message": "Extracting skills from vacancy with LLM..."})
    extracted = await ai_service.extract_fields(vacancy.description or vacancy.title or "")
    skill_list = extracted.get("skills") or vacancy.skills or []
    skill_text = ", ".join(skill_list[:20]) if skill_list else (vacancy.title or "")
    query_vector = await embed(skill_text)
    await emit({"step": "skills_ready", "skills": skill_list,
                "message": f"Skills: {', '.join(skill_list[:5])}{'...' if len(skill_list) > 5 else ''}"})

    # Search plan
    live_plan = [
        f"Step 1 → fetch {LIVE_POOL_PAGES * LIVE_POOL_PER_PAGE:,} resumes from HH.uz ({LIVE_POOL_PAGES}p × {LIVE_POOL_PER_PAGE})",
        f"Step 2 → embed all resumes → temporary Qdrant collection",
        f"Step 3 → cosine similarity search (threshold ≥{settings.live_pool_score_threshold}, top {settings.pool_top_k})",
        f"Step 4 → re-score top {settings.pool_rescore_n} with Ollama LLM",
        f"Step 5 → save top {settings.pool_top_n} with score ≥{MIN_SCORE}% to MongoDB",
        f"Step 6 → delete temp collection",
    ]
    await emit({
        "step": "queries_ready",
        "queries": live_plan,
        "message": "Search plan: " + "  →  ".join([
            f"fetch {LIVE_POOL_PAGES * LIVE_POOL_PER_PAGE:,}",
            "embed → index",
            f"search ≥{settings.live_pool_score_threshold}",
            f"score top {settings.pool_rescore_n}",
            f"save top {settings.pool_top_n}",
        ]),
    })

    # Step 2 — Create temp collection
    await ensure_temp_collection(qdrant, tmp_collection)
    await emit({"step": "collection_created", "collection": tmp_collection,
                "message": f"Temp Qdrant collection '{tmp_collection}' ready."})

    try:
        # Step 3 — Fetch stub IDs from HH (20 pages × 100)
        await emit({"step": "fetching_hh",
                    "message": f"Fetching {LIVE_POOL_PAGES} pages × {LIVE_POOL_PER_PAGE} from HH.uz..."})
        token = await get_valid_token()
        if not token:
            raise RuntimeError("No HH.uz token available")
        headers = {**_build_headers(), "Authorization": f"Bearer {token}"}
        area_id = vacancy.area_hh_id or settings.uzbekistan_area_id

        sem_fetch = asyncio.Semaphore(3)
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as http_client:
            async def fetch_page(p: int) -> list[str]:
                async with sem_fetch:
                    items, _ = await _fetch_resume_page(
                        http_client, headers, area_id, p, LIVE_POOL_PER_PAGE
                    )
                    return [r["id"] for r in items if r.get("id")]

            pages_results = await asyncio.gather(
                *[fetch_page(p) for p in range(LIVE_POOL_PAGES)]
            )

        stub_ids: list[str] = list(dict.fromkeys(
            rid for page_ids in pages_results for rid in page_ids
        ))
        await emit({"step": "hh_fetched", "count": len(stub_ids),
                    "message": f"Collected {len(stub_ids)} unique resume IDs from HH.uz."})

        # Step 4 — Fetch full resumes, embed, upsert in batches of 50
        total_upserted = 0
        batch_size = 50
        total_batches = -(-len(stub_ids) // batch_size)
        for i in range(0, len(stub_ids), batch_size):
            # Small pause between batches to respect HH.uz rate limits
            if i > 0:
                await asyncio.sleep(settings.live_pool_batch_delay)
            batch_ids = stub_ids[i: i + batch_size]
            full_resumes, rate_limited = await hh_service.get_resume_details_bulk(batch_ids, concurrency=CONCURRENCY)
            if rate_limited:
                await emit({
                    "step": "rate_limit",
                    "message": f"hh.uz rate limited {rate_limited} request(s) in this batch — some resumes skipped.",
                })
            valid = [r for r in full_resumes if r.get("id")]
            texts = [build_resume_text(r) for r in valid]
            vectors = await embed_batch(texts)
            upserted = await upsert_to_temp_collection(qdrant, tmp_collection, valid, vectors)
            total_upserted += upserted
            await emit({"step": "embedding_progress",
                        "batch": i // batch_size + 1, "total_batches": total_batches,
                        "upserted": total_upserted,
                        "message": f"Batch {i // batch_size + 1}/{total_batches}: {total_upserted} indexed."})

        await emit({"step": "pool_ready", "total": total_upserted,
                    "message": f"Temp pool ready: {total_upserted} candidates indexed."})

        # Step 5 — Vector search with threshold 0.85
        await emit({"step": "searching",
                    "message": f"Searching temp pool (threshold ≥{settings.live_pool_score_threshold})..."})
        pool_hits = await search_temp_collection(
            qdrant, tmp_collection, query_vector,
            top_k=settings.pool_top_k,
            score_threshold=settings.live_pool_score_threshold,
        )
        await emit({"step": "search_done", "hits": len(pool_hits),
                    "message": f"Vector search returned {len(pool_hits)} candidates above threshold."})

        if not pool_hits:
            return 0, 0

        # Step 6 — Ollama re-score top pool_rescore_n (30)
        resumes_to_score = [
            hit["raw_resume_json"]
            for hit in pool_hits[:settings.pool_rescore_n]
            if hit.get("raw_resume_json")
        ]
        await emit({"step": "scoring", "total": len(resumes_to_score),
                    "message": f"AI re-scoring {len(resumes_to_score)} candidates with Ollama..."})
        sem_score = asyncio.Semaphore(SCORE_CONCURRENCY)
        score_resume = _make_scorer(vacancy, sem_score)
        scored: list[tuple[dict, int]] = list(
            await asyncio.gather(*[score_resume(r) for r in resumes_to_score])
        )
        good = [(r, s) for r, s in scored if s >= MIN_SCORE]
        good.sort(key=lambda x: x[1], reverse=True)
        top_score = max((s for _, s in scored), default=0)
        await emit({"step": "scored", "passed": len(good), "total": len(scored), "top_score": top_score,
                    "message": f"{len(good)}/{len(scored)} passed ≥{MIN_SCORE}% (top: {top_score}%)."})

        # Step 7 — Save top pool_top_n (10) to MongoDB
        top = good[:settings.pool_top_n]
        tagged = [({**r, "_source": "live_pool"}, s) for r, s in top]
        count = await candidate_service.replace_candidates(vacancy, tagged)
        vacancy.last_matched_at = datetime.now(timezone.utc)
        await vacancy.save()

        return count, len(good)

    finally:
        # Step 8 — Always delete temp collection
        await delete_temp_collection(qdrant, tmp_collection)
        await emit({"step": "cleanup", "message": f"Temporary collection '{tmp_collection}' deleted."})


async def match_from_live_pool(vacancy_id: str):
    """
    Live-pool flow: fetch 2000 HH candidates → temporary Qdrant collection
    → vector search ≥0.85 → Ollama re-score → top-10 saved to MongoDB → cleanup.
    """
    vacancy = await vacancy_service.get_vacancy(vacancy_id)
    if not vacancy:
        raise HTTPException(status_code=404, detail="Vacancy not found")
    if vacancy.status != VacancyStatus.approved:
        raise HTTPException(status_code=422, detail="Vacancy must be approved to match candidates")

    async def _noop(event: dict) -> None:
        logger.debug("live_pool [%s]: %s", event.get("step"), event.get("message", ""))

    count, qualifying = await _run_live_pool_pipeline(vacancy, emit=_noop)
    logger.info("match_from_live_pool: saved %d/%d qualifying for vacancy %s", count, qualifying, vacancy_id)
    return {"matched": count, "total": qualifying, "last_matched_at": vacancy.last_matched_at}


async def match_from_live_pool_stream(vacancy_id: str):
    """SSE streaming version of match-from-live-pool."""

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

                count, qualifying = await _run_live_pool_pipeline(vacancy, emit=emit)

                if count:
                    await emit({
                        "step": "done", "matched": count, "qualifying": qualifying,
                        "message": (
                            f"Done! Saved {count} candidates from live pool "
                            f"(from {qualifying} qualifying ≥{MIN_SCORE}%)."
                        ),
                    })
                else:
                    await emit({
                        "step": "done", "matched": 0, "qualifying": 0,
                        "message": (
                            f"No candidates scored ≥{MIN_SCORE}% from live pool. "
                            "Try adjusting vacancy skills or description."
                        ),
                    })

            except Exception as exc:
                logger.error("match_from_live_pool_stream error: %s", exc)
                await emit({"step": "error", "message": f"Live pool match failed: {exc}"})
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
router.add_api_route("/vacancies/{vacancy_id}/match-from-live-pool", match_from_live_pool, methods=["POST"])
router.add_api_route("/vacancies/{vacancy_id}/match-from-live-pool-stream", match_from_live_pool_stream, methods=["GET"])
