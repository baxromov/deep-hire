import asyncio
import hashlib
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse

from beanie import PydanticObjectId

from app.config import settings
from app.database import get_qdrant
from app.models.vacancy import VacancyStatus
from app.services import ai_service, candidate_service, file_service, hh_mcp_service, hh_service, hh_vacancy_service, minio_service, vacancy_service
from app.services.embedding_service import build_resume_text, build_vacancy_text, embed, embed_batch, rerank
from app.services.ingestion_service import _fetch_resume_page
from app.services.qdrant_service import (
    collection_info,
    search_candidates,
    ensure_collection,
    upsert_candidates,
    ensure_temp_collection,
    upsert_to_temp_collection,
    upsert_items_to_temp_collection,
    search_temp_collection,
    search_temp_collection_scored,
    delete_temp_collection,
)

router = APIRouter(prefix="/api/matching", tags=["matching"])
logger = logging.getLogger(__name__)

MAX_PAGES = settings.hh_max_search_pages  # Problem 6: hard cap (default 3 pages)
PER_PAGE = 50           # results per HH page
CONCURRENCY = 5         # parallel HH detail-fetch requests
SCORE_CONCURRENCY = 10  # parallel Ollama scoring calls
REMATCH_TOP_N = 50      # top candidates saved after vector reranking
DB_VECTOR_PRESCORE_N = 25  # Qdrant pre-filter: score only top-N before LLM
MAX_COMBINED_RERANK = 30  # cap on how many already-found candidates get re-scored in one combined pass

# Read thresholds from settings (tunable via env vars — used by pool flows)
MIN_SCORE: int = settings.match_min_score
TOP_N: int = settings.match_top_n

LIVE_POOL_PAGES: int = settings.live_pool_pages
LIVE_POOL_PER_PAGE: int = settings.live_pool_per_page

# Vacancy.experience bucket → minimum years, for hh MCP search filters
HH_EXPERIENCE_MIN_YEARS = {
    "noExperience": 0,
    "between1And3": 1,
    "between3And6": 3,
    "moreThan6": 6,
}


def _make_scorer(vacancy, sem: asyncio.Semaphore):
    """Return an async scoring function bound to a vacancy and semaphore."""
    async def _score(resume: dict) -> tuple[dict, int]:
        if not settings.use_llm_scoring:
            sc = int(resume.get("_qdrant_score", 0.0) * 100)
            return resume, sc
        async with sem:
            skills = [
                s if isinstance(s, str) else s.get("name", "")
                for s in (resume.get("skill_set") or [])
            ]
            raw = resume.get("raw_resume_json") or {}
            work_exp = (
                raw.get("work_experience")
                or raw.get("extracted", {}).get("experience")
                or resume.get("work_experience")
                or []
            )
            sc, _rs, _cr = await ai_service.score_candidate(
                vacancy_title=vacancy.title or "",
                vacancy_description=vacancy.description or "",
                required_skills=vacancy.skills,
                experience=vacancy.experience or "",
                candidate_title=resume.get("title", ""),
                candidate_skills=skills,
                work_experience=work_exp[:3],
            )
        return resume, sc
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

    from app.models.match_candidate_hit import MatchCandidateHit
    from app.models.match_result import MatchResult as MatchResultModel
    await MatchResultModel.find({"vacancy_id": vacancy.id, "source": "hh_search"}).delete()
    await MatchCandidateHit.find({"vacancy_id": vacancy.id, "source": "hh_search"}).delete()
    staged = await candidate_service.stage_hh_hits(vacancy, top, source="hh_search")
    count = staged["linked"] + staged["staged"]
    vacancy.last_matched_at = datetime.now(timezone.utc)
    await vacancy.save()

    logger.info("rematch: matched %d top candidates from %d total for vacancy %s", count, len(all_resumes), vacancy_id)
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
    score, _reasoning, _criteria = await ai_service.score_candidate(
        vacancy_title=vacancy.title or "",
        required_skills=vacancy.skills,
        experience=vacancy.experience or "",
        candidate_title=fields.get("title", ""),
        candidate_skills=fields.get("skills", []),
        vacancy_description=vacancy.description or "",
        work_experience=(fields.get("experience") or [])[:3],
    )

    # Use file hash as a stable unique ID
    file_hash = hashlib.md5(file_bytes).hexdigest()[:16]

    from app.models.candidate import Candidate
    from beanie import PydanticObjectId

    # Upload file to MinIO for later retrieval
    minio_key = None
    try:
        minio_key = await minio_service.upload_file(file_bytes, file.filename)
    except Exception:
        pass

    candidate_data = {
        "vacancy_id": vacancy.id,
        "hh_resume_id": f"file:{file_hash}",
        "first_name": fields.get("first_name"),
        "last_name": fields.get("last_name"),
        "title": fields.get("title"),
        "area": fields.get("area"),
        "salary_amount": fields.get("salary_amount"),
        "salary_currency": fields.get("salary_currency"),
        "skills": fields.get("skills", []),
        "relevance_score": score,
        "raw_resume_json": {"source": "file", "filename": file.filename, "extracted": fields, "minio_key": minio_key},
        "matched_at": datetime.now(timezone.utc),
    }

    # Atomic upsert — avoids delete+insert race condition that caused duplicates
    col = Candidate.get_motor_collection()
    upsert_filter = {"vacancy_id": vacancy.id, "hh_resume_id": f"file:{file_hash}"}
    result = await col.update_one(upsert_filter, {"$set": candidate_data}, upsert=True)
    candidate_oid = result.upserted_id or (
        await col.find_one(upsert_filter, {"_id": 1})
    )["_id"]

    if minio_key:
        resume_url = f"/api/candidates/{candidate_oid}/resume"
        await col.update_one({"_id": candidate_oid}, {"$set": {"resume_url": resume_url}})

    # Remove pool duplicate (vacancy_id=None) with same file hash to prevent double entries
    await col.delete_many({"vacancy_id": None, "hh_resume_id": f"file:{file_hash}", "_id": {"$ne": candidate_oid}})

    # Index uploaded resume into main Qdrant collection so "Из нашей базы" can find it later
    try:
        qdrant_resume = {
            "id": f"file:{file_hash}",
            "first_name": fields.get("first_name"),
            "last_name": fields.get("last_name"),
            "title": fields.get("title") or fields.get("position"),
            "area": {"name": fields.get("area")} if fields.get("area") else {},
            "salary": {
                "amount": fields.get("salary_amount"),
                "currency": fields.get("salary_currency"),
            },
            "skill_set": fields.get("skills", []),
            "experience": [],
        }
        qdrant = await get_qdrant()
        await ensure_collection(qdrant)
        resume_vec = await embed(text[:4000])
        await upsert_candidates(qdrant, [qdrant_resume], [resume_vec], [str(candidate_oid)])
        logger.info("match_from_file: indexed file:%s into main Qdrant collection", file_hash)
    except Exception as exc:
        logger.warning("match_from_file: Qdrant indexing failed (non-fatal): %s", exc)

    # Also search Qdrant pool using the file text as query — find similar candidates
    pool_count = 0
    try:
        qdrant = await get_qdrant()
        pool = await collection_info(qdrant)
        if pool["points_count"] > 0:
            file_vector = await embed(text[:4000])
            pool_hits = await search_candidates(qdrant, file_vector, top_k=settings.pool_top_k)
            if pool_hits:
                resumes_to_score = [
                    {**hit["raw_resume_json"], "_candidate_id": hit.get("candidate_id")}
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
                tagged = [({**r, "_source": "talent_pool"}, s) for r, s in top]
                staged = await candidate_service.stage_pool_hits(vacancy, tagged, source="talent_pool")
                pool_count = staged["linked"] + staged["staged"]
    except Exception as exc:
        logger.warning("match_from_file: pool search failed: %s", exc)

    total = 1 + pool_count
    logger.info("match_from_file: saved candidate score=%d + %d pool for vacancy %s", score, pool_count, vacancy_id)
    return {
        "id": str(candidate_oid),
        "name": " ".join(filter(None, [fields.get("first_name"), fields.get("last_name")])) or fields.get("title") or "Unknown",
        "score": score,
        "total": total,
        "pool_matched": pool_count,
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

                from app.models.match_candidate_hit import MatchCandidateHit
                from app.models.match_result import MatchResult as MatchResultModel
                await MatchResultModel.find({"vacancy_id": vacancy.id, "source": "hh_search"}).delete()
                await MatchCandidateHit.find({"vacancy_id": vacancy.id, "source": "hh_search"}).delete()
                staged = await candidate_service.stage_hh_hits(vacancy, top, source="hh_search")
                count = staged["linked"] + staged["staged"]
                vacancy.last_matched_at = datetime.now(timezone.utc)
                await vacancy.save()

                await emit({
                    "step": "done",
                    "matched": count,
                    "total_collected": len(all_resumes),
                    "message": f"Done! Matched top {count} candidates (from {len(all_resumes)} collected, ranked by vector similarity).",
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
        {**hit["raw_resume_json"], "_candidate_id": hit.get("candidate_id")}
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
    staged = await candidate_service.stage_pool_hits(vacancy, tagged, source="talent_pool")
    count = staged["linked"] + staged["staged"]
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
                    {**hit["raw_resume_json"], "_candidate_id": hit.get("candidate_id")}
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
                staged = await candidate_service.stage_pool_hits(vacancy, tagged, source="talent_pool")
                count = staged["linked"] + staged["staged"]
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

        from app.models.match_candidate_hit import MatchCandidateHit
        from app.models.match_result import MatchResult as MatchResultModel
        await MatchResultModel.find({"vacancy_id": vacancy.id, "source": "live_pool"}).delete()
        await MatchCandidateHit.find({"vacancy_id": vacancy.id, "source": "live_pool"}).delete()
        staged = await candidate_service.stage_hh_hits(vacancy, tagged, source="live_pool")
        count = staged["linked"] + staged["staged"]
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


async def match_from_db_stream(vacancy_id: str, min_score: int = Query(40, ge=0, le=100)):
    """SSE: search main Qdrant collection directly (no MongoDB pre-fetch, no re-embedding)."""

    async def event_stream():
        queue: asyncio.Queue[dict | None] = asyncio.Queue()

        async def emit(event: dict) -> None:
            await queue.put(event)

        async def run() -> None:
            try:
                vacancy = await vacancy_service.get_vacancy(vacancy_id)
                if not vacancy:
                    await emit({"step": "error", "message": "Vacancy not found."}); return
                if vacancy.status != VacancyStatus.approved:
                    await emit({"step": "error", "message": "Vacancy must be approved."}); return

                qdrant = await get_qdrant()
                pool = await collection_info(qdrant)
                total_indexed = pool["points_count"]

                await emit({
                    "step": "planning",
                    "message": f"Searching {total_indexed:,} candidates in Qdrant (threshold ≥{min_score}%)…",
                })

                if total_indexed == 0:
                    await emit({"step": "done", "message": "Qdrant is empty.", "matched": 0, "total": 0})
                    return

                # ── 1. Embed vacancy ──────────────────────────────────────────────
                await emit({"step": "embedding", "message": "Embedding vacancy into vector space…"})
                vacancy_vec = await embed(build_vacancy_text(vacancy))

                # ── 2. Search main Qdrant collection with low threshold ────────────
                # Use min_score/100 as Qdrant threshold so we get all relevant hits
                qdrant_threshold = max(0.0, (min_score - 5) / 100)
                await emit({
                    "step": "searching",
                    "message": f"Searching Qdrant for top {settings.pool_top_k} candidates…",
                })
                pool_hits = await search_candidates(
                    qdrant,
                    vacancy_vec,
                    top_k=settings.pool_top_k,
                    score_threshold=qdrant_threshold,
                )

                if not pool_hits:
                    await emit({
                        "step": "done",
                        "message": f"No candidates found (Qdrant threshold={qdrant_threshold:.2f}). Try lowering the score threshold.",
                        "matched": 0, "total": 0,
                    })
                    return

                await emit({
                    "step": "fetched",
                    "count": len(pool_hits),
                    "message": f"Retrieved {len(pool_hits)} candidates from Qdrant.",
                    "total": len(pool_hits),
                })

                # ── 3. Rerank (cross-encoder) if enabled ─────────────────────────
                now = datetime.now(timezone.utc)
                vacancy_skills_set = {s.lower() for s in (vacancy.skills or [])}
                vacancy_query = build_vacancy_text(vacancy)

                if settings.use_reranker and pool_hits:
                    rerank_pool = pool_hits[:settings.reranker_top_n]
                    await emit({
                        "step": "reranking",
                        "message": f"Cross-encoder reranking top {len(rerank_pool)} candidates…",
                    })
                    doc_texts = [
                        build_resume_text(hit["raw_resume_json"])
                        if hit.get("raw_resume_json") else
                        f"{hit.get('title', '')}. Skills: {', '.join(hit.get('skills', []))}"
                        for hit in rerank_pool
                    ]
                    rerank_results = await rerank(vacancy_query, doc_texts, top_n=settings.reranker_top_n)

                    # Re-order pool_hits by reranker score, then skill-boost the final score
                    reranked_hits = []
                    for r in rerank_results:
                        idx = r.get("index", 0)
                        if idx < len(rerank_pool):
                            hit = rerank_pool[idx]
                            reranked_hits.append((hit, r.get("relevance_score", 0.0)))
                    # Append any hits beyond reranker_top_n (no rerank, use qdrant score)
                    for hit in pool_hits[settings.reranker_top_n:]:
                        reranked_hits.append((hit, hit.get("_qdrant_score", 0.0) * 0.8))

                    await emit({
                        "step": "reranked",
                        "count": len(reranked_hits),
                        "message": f"Reranking done — scoring {len(reranked_hits)} candidates with skill boost…",
                    })

                    scored = []
                    for hit, rerank_sc in reranked_hits:
                        raw = hit.get("raw_resume_json")
                        if not raw:
                            continue
                        # Skill overlap bonus (0–15 pts): rewards candidates matching required skills
                        candidate_skills = {s.lower() for s in (hit.get("skills") or [])}
                        overlap = len(vacancy_skills_set & candidate_skills)
                        skill_bonus = min(15, overlap * 3) if vacancy_skills_set else 0
                        # Blend reranker score (0–1 → 0–85) + skill bonus (0–15)
                        final_sc = min(100, int(rerank_sc * 85) + skill_bonus)
                        if final_sc >= min_score:
                            scored.append((
                                {**raw, "_source": "db_search", "_vector_score": final_sc, "_candidate_id": hit.get("candidate_id")},
                                final_sc,
                            ))
                    scored.sort(key=lambda x: x[1], reverse=True)

                    # LLM scoring on top candidates after reranker
                    # Falls back to reranker score if LLM fails or returns 0
                    LLM_SCORE_LIMIT = 10
                    to_llm = scored[:LLM_SCORE_LIMIT]
                    if to_llm:
                        await emit({
                            "step": "llm_scoring",
                            "total": len(to_llm),
                            "message": f"LLM оценивает топ-{len(to_llm)} кандидатов после reranker…",
                        })
                        sem_llm = asyncio.Semaphore(SCORE_CONCURRENCY)

                        async def _llm_score_one(item: tuple) -> tuple:
                            resume, reranker_sc = item
                            async with sem_llm:
                                cand_skills = [
                                    s if isinstance(s, str) else s.get("name", "")
                                    for s in (resume.get("skill_set") or [])
                                ]
                                raw_r = resume.get("raw_resume_json") or {}
                                work_exp_r = (
                                    raw_r.get("work_experience")
                                    or raw_r.get("extracted", {}).get("experience")
                                    or resume.get("work_experience")
                                    or []
                                )
                                llm_sc, reasoning, criteria = await ai_service.score_candidate(
                                    vacancy_title=vacancy.title or "",
                                    vacancy_description=vacancy.description or "",
                                    required_skills=vacancy.skills,
                                    experience=vacancy.experience or "",
                                    candidate_title=resume.get("title", ""),
                                    candidate_skills=cand_skills,
                                    work_experience=work_exp_r[:3],
                                )
                                # Fall back to reranker score if LLM failed (returns 0)
                                final_sc = llm_sc if llm_sc > 0 else reranker_sc
                                enriched = {
                                    **resume,
                                    "score_reasoning": reasoning,
                                    "score_criteria": criteria,
                                    "_llm_score": llm_sc if llm_sc > 0 else None,
                                }
                                return enriched, final_sc

                        raw_results = await asyncio.gather(
                            *[_llm_score_one(t) for t in to_llm],
                            return_exceptions=True,
                        )
                        enriched: list[tuple] = []
                        for i, res in enumerate(raw_results):
                            if isinstance(res, Exception):
                                # LLM call crashed — keep original reranker item unchanged
                                enriched.append(to_llm[i])
                            else:
                                enriched.append(res)
                        # Combine enriched top-N + remaining beyond LLM limit, re-apply threshold
                        combined = enriched + scored[LLM_SCORE_LIMIT:]
                        scored = [(r, s) for r, s in combined if s >= min_score]
                        scored.sort(key=lambda x: x[1], reverse=True)
                        await emit({
                            "step": "llm_scored",
                            "count": len(scored),
                            "message": f"LLM оценка завершена — {len(scored)} кандидатов прошли порог ≥{min_score}%",
                        })

                else:
                    # ── No reranker: cosine score + skill bonus ───────────────────
                    scored = []
                    for hit in pool_hits:
                        raw = hit.get("raw_resume_json")
                        if not raw:
                            continue
                        candidate_skills = {s.lower() for s in (hit.get("skills") or [])}
                        overlap = len(vacancy_skills_set & candidate_skills)
                        skill_bonus = min(15, overlap * 3) if vacancy_skills_set else 0
                        qdrant_sc = int(hit.get("_qdrant_score", 0) * 85)
                        final_sc = min(100, qdrant_sc + skill_bonus)
                        if final_sc >= min_score:
                            scored.append((
                                {**raw, "_source": "db_search", "_vector_score": final_sc, "_candidate_id": hit.get("candidate_id")},
                                final_sc,
                            ))
                    scored.sort(key=lambda x: x[1], reverse=True)

                    # ── LLM scoring on top candidates (no-reranker path) ──────────
                    LLM_SCORE_LIMIT = 10
                    to_llm = scored[:LLM_SCORE_LIMIT]
                    if to_llm:
                        await emit({
                            "step": "llm_scoring",
                            "total": len(to_llm),
                            "message": f"LLM оценивает топ-{len(to_llm)} кандидатов…",
                        })
                        sem_llm = asyncio.Semaphore(SCORE_CONCURRENCY)

                        async def _llm_score_cosine(item: tuple) -> tuple:
                            resume, cosine_sc = item
                            async with sem_llm:
                                cand_skills = [
                                    s if isinstance(s, str) else s.get("name", "")
                                    for s in (resume.get("skill_set") or [])
                                ]
                                raw_r = resume.get("raw_resume_json") or {}
                                work_exp_r = (
                                    raw_r.get("work_experience")
                                    or raw_r.get("extracted", {}).get("experience")
                                    or resume.get("work_experience")
                                    or []
                                )
                                llm_sc, reasoning, criteria = await ai_service.score_candidate(
                                    vacancy_title=vacancy.title or "",
                                    vacancy_description=vacancy.description or "",
                                    required_skills=vacancy.skills,
                                    experience=vacancy.experience or "",
                                    candidate_title=resume.get("title", ""),
                                    candidate_skills=cand_skills,
                                    work_experience=work_exp_r[:3],
                                    criteria=vacancy.score_criteria,
                                )
                                final_sc = llm_sc if llm_sc > 0 else cosine_sc
                                enriched = {
                                    **resume,
                                    "score_reasoning": reasoning,
                                    "score_criteria": criteria,
                                    "_llm_score": llm_sc if llm_sc > 0 else None,
                                }
                                return enriched, final_sc

                        raw_results = await asyncio.gather(
                            *[_llm_score_cosine(t) for t in to_llm],
                            return_exceptions=True,
                        )
                        enriched_results: list[tuple] = []
                        for i, res in enumerate(raw_results):
                            if isinstance(res, Exception):
                                enriched_results.append(to_llm[i])
                            else:
                                enriched_results.append(res)
                        combined = enriched_results + scored[LLM_SCORE_LIMIT:]
                        scored = [(r, s) for r, s in combined if s >= min_score]
                        scored.sort(key=lambda x: x[1], reverse=True)
                        await emit({
                            "step": "llm_scored",
                            "count": len(scored),
                            "message": f"LLM оценка завершена — {len(scored)} кандидатов прошли порог ≥{min_score}%",
                        })

                for proc, (resume, sc) in enumerate(scored, 1):
                    name = (
                        resume.get("full_name")
                        or resume.get("first_name", "")
                        or resume.get("title")
                        or "Unknown"
                    )
                    await emit({
                        "step": "scoring",
                        "message": f"[{proc}/{len(scored)}] \"{name}\" → {sc}% ✓",
                        "count": proc, "total": len(scored), "matched": proc,
                    })

                # Delete stale db_search MatchResults/staged hits for this vacancy before saving fresh batch
                from app.models.match_candidate_hit import MatchCandidateHit
                from app.models.match_result import MatchResult as MatchResultModel
                await MatchResultModel.find({
                    "vacancy_id": vacancy.id,
                    "source": "db_search",
                }).delete()
                await MatchCandidateHit.find({"vacancy_id": vacancy.id, "source": "db_search"}).delete()

                staged = await candidate_service.stage_pool_hits(vacancy, scored, source="db_search")
                count = staged["linked"] + staged["staged"]
                vacancy.last_matched_at = now
                await vacancy.save()

                await emit({
                    "step": "done",
                    "message": f"Done. Saved {count} candidates from Qdrant (threshold ≥{min_score}%).",
                    "matched": count, "total": len(pool_hits),
                })

            except Exception as exc:
                logger.error("match_from_db_stream error: %s", exc, exc_info=True)
                await emit({"step": "error", "message": f"Error: {exc}"})
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


async def match_from_hh_stream(
    vacancy_id: str,
    min_score: int = Query(MIN_SCORE, ge=0, le=100),
    include_companies: str | None = Query(None, description="Comma-separated company names — only candidates who worked there"),
    exclude_companies: str | None = Query(None, description="Comma-separated company names — drop candidates who worked there"),
):
    """SSE: LLM fills HH MCP search params from the vacancy, searches HeadHunter via
    search_candidate_hh, LLM-scores results against vacancy criteria, auto-saves top
    matches with source='hh'."""

    async def event_stream():
        queue: asyncio.Queue[dict | None] = asyncio.Queue()

        async def emit(event: dict) -> None:
            await queue.put(event)

        async def run() -> None:
            try:
                vacancy = await vacancy_service.get_vacancy(vacancy_id)
                if not vacancy:
                    await emit({"step": "error", "message": "Vacancy not found."}); return
                if vacancy.status != VacancyStatus.approved:
                    await emit({"step": "error", "message": "Vacancy must be approved."}); return

                # ── LLM fills the HH search params from the vacancy ──────────────
                await emit({"step": "planning", "message": "LLM формирует параметры поиска по вакансии…"})
                extracted = await ai_service.extract_fields(vacancy.description or vacancy.title or "")
                skill_list = extracted.get("skills") or vacancy.skills or []
                # Keep the free-text query broad (title, or a few top skills) — a long
                # comma-joined skill list reads as an overly-narrow AND-style query to HH.
                text = vacancy.title or (", ".join(skill_list[:5]) if skill_list else "")

                include_companies_list = [c.strip() for c in include_companies.split(",") if c.strip()] if include_companies else None
                exclude_companies_list = [c.strip() for c in exclude_companies.split(",") if c.strip()] if exclude_companies else None

                hh_params: dict = {
                    "text": text,
                    "region": vacancy.area,
                    "min_experience": HH_EXPERIENCE_MIN_YEARS.get(vacancy.experience),
                    "min_salary": vacancy.salary_from,
                    "max_salary": vacancy.salary_to,
                    "currency": vacancy.currency if (vacancy.salary_from or vacancy.salary_to) else None,
                    "employment": [vacancy.employment_type] if vacancy.employment_type else None,
                    "schedule": [vacancy.schedule] if vacancy.schedule else None,
                    "include_companies": include_companies_list,
                    "exclude_companies": exclude_companies_list,
                }
                companies_note = ""
                if include_companies_list:
                    companies_note += f", только компании: {', '.join(include_companies_list)}"
                if exclude_companies_list:
                    companies_note += f", исключая: {', '.join(exclude_companies_list)}"
                await emit({
                    "step": "embedding",
                    "message": f"Параметры: текст=«{text[:80]}», регион={vacancy.area or '—'}, "
                               f"опыт от {hh_params['min_experience'] if hh_params['min_experience'] is not None else '—'} лет"
                               f"{companies_note}",
                })

                await emit({"step": "searching", "message": "Поиск резюме на HH.ru…"})
                result = await hh_mcp_service.search_candidates_hh(**hh_params, limit=10, page=0)
                raw_candidates = result.get("candidates", [])

                # Tool itself hints to drop the most specific filter when nothing matches —
                # retry once without min_experience before giving up.
                if not raw_candidates and hh_params.get("min_experience") is not None:
                    await emit({"step": "searching", "message": "Ничего не найдено — повторяю поиск без фильтра по опыту…"})
                    retry_params = {**hh_params, "min_experience": None}
                    result = await hh_mcp_service.search_candidates_hh(**retry_params, limit=10, page=0)
                    raw_candidates = result.get("candidates", [])

                await emit({
                    "step": "fetched",
                    "count": len(raw_candidates),
                    "total": result.get("total", 0),
                    "message": f"HH returned {len(raw_candidates)} candidates (pool: {result.get('total', 0):,}).",
                })

                if not raw_candidates:
                    await emit({"step": "done", "matched": 0, "total": 0, "message": "No candidates found on HH.ru."})
                    return

                adapted = [hh_mcp_service.adapt_hh_candidate(c) for c in raw_candidates]

                await emit({
                    "step": "llm_scoring",
                    "total": len(adapted),
                    "message": f"LLM scoring {len(adapted)} HH candidates against vacancy criteria…",
                })
                sem = asyncio.Semaphore(SCORE_CONCURRENCY)

                async def _score(resume: dict) -> tuple[dict, int]:
                    async with sem:
                        sc, reasoning, criteria = await ai_service.score_candidate(
                            vacancy_title=vacancy.title or "",
                            vacancy_description=vacancy.description or "",
                            required_skills=vacancy.skills,
                            experience=vacancy.experience or "",
                            candidate_title=resume.get("position") or resume.get("title") or "",
                            candidate_skills=resume.get("skill_set") or [],
                            work_experience=(resume.get("work_experience") or [])[:3],
                            criteria=vacancy.score_criteria,
                        )
                        return {
                            **resume,
                            "_source": "hh",
                            "score_reasoning": reasoning,
                            "score_criteria": criteria,
                            "_llm_score": sc if sc > 0 else None,
                        }, sc

                raw_results = await asyncio.gather(*[_score(r) for r in adapted], return_exceptions=True)
                scored = [r for r in raw_results if not isinstance(r, Exception)]
                good = sorted([(r, s) for r, s in scored if s >= min_score], key=lambda x: x[1], reverse=True)
                await emit({
                    "step": "llm_scored",
                    "count": len(good),
                    "total": len(scored),
                    "message": f"{len(good)}/{len(scored)} passed ≥{min_score}%.",
                })

                for i, (resume, sc) in enumerate(good, 1):
                    name = resume.get("full_name") or resume.get("position") or "Unknown"
                    await emit({
                        "step": "scoring",
                        "count": i, "total": len(good), "matched": i,
                        "message": f"[{i}/{len(good)}] \"{name}\" → {sc}% ✓",
                    })

                from app.models.match_candidate_hit import MatchCandidateHit
                from app.models.match_result import MatchResult as MatchResultModel
                await MatchResultModel.find({"vacancy_id": vacancy.id, "source": "hh"}).delete()
                await MatchCandidateHit.find({"vacancy_id": vacancy.id, "source": "hh"}).delete()
                staged = await candidate_service.stage_hh_hits(vacancy, good, source="hh")
                count = staged["linked"] + staged["staged"]
                vacancy.last_matched_at = datetime.now(timezone.utc)
                await vacancy.save()

                await emit({
                    "step": "done",
                    "matched": count, "total": len(good),
                    "message": f"Done. {staged['linked']} already in DB, {staged['staged']} new from HH.ru.",
                })
            except Exception as exc:
                logger.error("match_from_hh_stream error: %s", exc, exc_info=True)
                await emit({"step": "error", "message": f"HH search failed: {exc}"})
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


async def match_from_hh_responses_stream(vacancy_id: str, min_score: int = Query(MIN_SCORE, ge=0, le=100)):
    """SSE: LLM-score applicants who already responded to this hh.ru vacancy
    (vacancy_responses_hh), auto-saves top matches with source='hh_responses'.
    Only usable for hh-backed vacancies (vacancy.hh_vacancy_id set) — see
    hh_vacancies.get_hh_vacancy, which creates that backing Vacancy on demand."""

    async def event_stream():
        queue: asyncio.Queue[dict | None] = asyncio.Queue()

        async def emit(event: dict) -> None:
            await queue.put(event)

        async def run() -> None:
            try:
                vacancy = await vacancy_service.get_vacancy(vacancy_id)
                if not vacancy:
                    await emit({"step": "error", "message": "Vacancy not found."}); return
                if vacancy.status != VacancyStatus.approved:
                    await emit({"step": "error", "message": "Vacancy must be approved."}); return
                if not vacancy.hh_vacancy_id:
                    await emit({"step": "error", "message": "Not an HH-backed vacancy."}); return

                await emit({"step": "planning", "message": "Загружаем отклики на вакансию с HH.ru…"})
                responses = await hh_vacancy_service.get_vacancy_responses_hh(vacancy.hh_vacancy_id)
                raw_applicants = responses.get("applicants", [])
                total = responses.get("total", len(raw_applicants))

                await emit({
                    "step": "fetched",
                    "count": len(raw_applicants),
                    "total": total,
                    "message": f"Загружено {len(raw_applicants)} полных анкет из {total} откликов "
                               f"(hh.ru отдаёт не более 10 полных профилей за раз).",
                })

                if not raw_applicants:
                    await emit({"step": "done", "matched": 0, "total": total, "message": "Откликов нет."})
                    return

                adapted = [hh_vacancy_service.adapt_hh_applicant(a) for a in raw_applicants]

                await emit({
                    "step": "llm_scoring",
                    "total": len(adapted),
                    "message": f"LLM оценивает {len(adapted)} откликнувшихся по критериям вакансии…",
                })
                sem = asyncio.Semaphore(SCORE_CONCURRENCY)

                async def _score(resume: dict) -> tuple[dict, int]:
                    async with sem:
                        cand_skills = [
                            s if isinstance(s, str) else (s.get("name") or s.get("skill") or "")
                            for s in (resume.get("skills") or [])
                        ]
                        sc, reasoning, criteria = await ai_service.score_candidate(
                            vacancy_title=vacancy.title or "",
                            vacancy_description=vacancy.description or "",
                            required_skills=vacancy.skills,
                            experience=vacancy.experience or "",
                            candidate_title=resume.get("position") or resume.get("title") or "",
                            candidate_skills=cand_skills,
                            work_experience=(resume.get("work_experience") or [])[:3],
                            criteria=vacancy.score_criteria,
                        )
                        return {
                            **resume,
                            "_source": "hh_responses",
                            "score_reasoning": reasoning,
                            "score_criteria": criteria,
                            "_llm_score": sc if sc > 0 else None,
                        }, sc

                raw_results = await asyncio.gather(*[_score(r) for r in adapted], return_exceptions=True)
                scored = [r for r in raw_results if not isinstance(r, Exception)]
                good = sorted([(r, s) for r, s in scored if s >= min_score], key=lambda x: x[1], reverse=True)
                await emit({
                    "step": "llm_scored",
                    "count": len(good),
                    "total": len(scored),
                    "message": f"{len(good)}/{len(scored)} прошли порог ≥{min_score}%.",
                })

                from app.models.match_candidate_hit import MatchCandidateHit
                from app.models.match_result import MatchResult as MatchResultModel
                await MatchResultModel.find({"vacancy_id": vacancy.id, "source": "hh_responses"}).delete()
                await MatchCandidateHit.find({"vacancy_id": vacancy.id, "source": "hh_responses"}).delete()
                staged = await candidate_service.stage_hh_hits(vacancy, good, source="hh_responses")
                count = staged["linked"] + staged["staged"]
                vacancy.last_matched_at = datetime.now(timezone.utc)
                await vacancy.save()

                await emit({
                    "step": "done",
                    "matched": count, "total": len(good),
                    "message": f"Done. {staged['linked']} already in DB, {staged['staged']} new from HH responses.",
                })
            except Exception as exc:
                logger.error("match_from_hh_responses_stream error: %s", exc, exc_info=True)
                await emit({"step": "error", "message": f"HH responses matching failed: {exc}"})
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


async def rerank_combined_stream(vacancy_id: str, min_score: int = Query(MIN_SCORE, ge=0, le=100)):
    """SSE: gather every candidate already found for this vacancy by any other
    method (real + staged), dedupe by person, and re-score all of them with ONE
    consistent LLM pass so scores are directly comparable across sources. Persists
    as source='combined' — doesn't create any new Candidate."""

    async def event_stream():
        queue: asyncio.Queue[dict | None] = asyncio.Queue()

        async def emit(event: dict) -> None:
            await queue.put(event)

        async def run() -> None:
            try:
                vacancy = await vacancy_service.get_vacancy(vacancy_id)
                if not vacancy:
                    await emit({"step": "error", "message": "Vacancy not found."}); return
                if vacancy.status != VacancyStatus.approved:
                    await emit({"step": "error", "message": "Vacancy must be approved."}); return

                await emit({"step": "planning", "message": "Собираем всех найденных кандидатов…"})
                pool = await candidate_service.get_combined_pool_for_vacancy(vacancy_id)

                if not pool:
                    await emit({
                        "step": "done", "matched": 0, "total": 0,
                        "message": "Пока нет кандидатов для объединения — сначала запустите другие методы.",
                    })
                    return

                pool.sort(key=lambda p: p["prior_score"], reverse=True)
                truncated = len(pool) > MAX_COMBINED_RERANK
                pool = pool[:MAX_COMBINED_RERANK]

                await emit({
                    "step": "fetched",
                    "count": len(pool),
                    "total": len(pool),
                    "message": f"Найдено {len(pool)} уникальных кандидатов"
                               + (f" (показаны топ-{MAX_COMBINED_RERANK})" if truncated else "") + ".",
                })

                await emit({
                    "step": "llm_scoring",
                    "total": len(pool),
                    "message": f"LLM переоценивает {len(pool)} кандидатов по единому критерию…",
                })
                sem = asyncio.Semaphore(SCORE_CONCURRENCY)

                async def _score(person: dict):
                    async with sem:
                        sc, reasoning, criteria = await ai_service.score_candidate(
                            vacancy_title=vacancy.title or "",
                            vacancy_description=vacancy.description or "",
                            required_skills=vacancy.skills,
                            experience=vacancy.experience or "",
                            candidate_title=person.get("title") or "",
                            candidate_skills=person.get("skills") or [],
                            work_experience=(person.get("work_experience") or [])[:3],
                            criteria=vacancy.score_criteria,
                        )
                        return person, sc, reasoning, criteria

                raw_results = await asyncio.gather(*[_score(p) for p in pool], return_exceptions=True)
                scored = [r for r in raw_results if not isinstance(r, Exception)]
                good = [r for r in scored if r[1] >= min_score]
                good.sort(key=lambda r: r[1], reverse=True)

                await emit({
                    "step": "llm_scored",
                    "count": len(good),
                    "total": len(scored),
                    "message": f"{len(good)}/{len(scored)} прошли порог ≥{min_score}%.",
                })

                from app.models.match_candidate_hit import MatchCandidateHit
                from app.models.match_result import MatchResult as MatchResultModel
                await MatchResultModel.find({"vacancy_id": vacancy.id, "source": "combined"}).delete()
                await MatchCandidateHit.find({"vacancy_id": vacancy.id, "source": "combined"}).delete()

                now = datetime.now(timezone.utc)
                mr_col = MatchResultModel.get_motor_collection()
                hit_col = MatchCandidateHit.get_motor_collection()
                for person, sc, reasoning, criteria in good:
                    common_fields = {
                        "relevance_score": sc,
                        "llm_score": sc,
                        "score_reasoning": reasoning,
                        "score_criteria": criteria,
                        "matched_at": now,
                        "source": "combined",
                    }
                    if person["candidate_id"]:
                        await mr_col.update_one(
                            {"vacancy_id": vacancy.id, "hh_resume_id": person["hh_resume_id"]},
                            {"$set": {
                                **common_fields,
                                "vacancy_id": vacancy.id,
                                "candidate_id": PydanticObjectId(person["candidate_id"]),
                                "hh_resume_id": person["hh_resume_id"],
                            }},
                            upsert=True,
                        )
                    else:
                        await hit_col.update_one(
                            {"vacancy_id": vacancy.id, "hh_resume_id": person["hh_resume_id"]},
                            {"$set": {
                                **person["_hit_fields"],
                                **common_fields,
                                "vacancy_id": vacancy.id,
                                "hh_resume_id": person["hh_resume_id"],
                            }},
                            upsert=True,
                        )

                await emit({
                    "step": "done",
                    "matched": len(good),
                    "total": len(scored),
                    "message": f"Done. {len(good)} candidates re-ranked with a unified score.",
                })
            except Exception as exc:
                logger.error("rerank_combined_stream error: %s", exc, exc_info=True)
                await emit({"step": "error", "message": f"Combined rerank failed: {exc}"})
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
router.add_api_route("/vacancies/{vacancy_id}/match-from-db-stream", match_from_db_stream, methods=["GET"])
router.add_api_route("/vacancies/{vacancy_id}/match-from-hh-stream", match_from_hh_stream, methods=["GET"])
router.add_api_route("/vacancies/{vacancy_id}/match-from-hh-responses-stream", match_from_hh_responses_stream, methods=["GET"])
router.add_api_route("/vacancies/{vacancy_id}/rerank-combined-stream", rerank_combined_stream, methods=["GET"])
