import asyncio
import hashlib
import logging
from datetime import datetime, timezone
from typing import List, Optional
from urllib.parse import quote as urlquote

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

logger = logging.getLogger(__name__)

from app.models.candidate import Candidate
from app.models.vacancy import Vacancy, VacancyStatus
from app.schemas.candidate import CandidateDetailResponse, CandidateResponse
from app.services import ai_service, candidate_service, file_service, minio_service

router = APIRouter(prefix="/api/candidates", tags=["candidates"])

SCORE_CONCURRENCY = 3


async def list_candidates(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    vacancy_id: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    sort_by: str = Query("score", pattern="^(score|date|name)$"),
    source: Optional[str] = Query(None, pattern="^(xlsx|file|hh)$"),
):
    items, total = await candidate_service.get_all_candidates(
        skip=skip, limit=limit, vacancy_id=vacancy_id,
        search=search, sort_by=sort_by, source=source,
    )
    return {"items": [CandidateResponse.from_doc(d) for d in items], "total": total}


async def get_candidate(candidate_id: str):
    doc = await candidate_service.get_candidate(candidate_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Candidate not found")
    return CandidateDetailResponse.from_doc(doc)


async def get_candidate_resume(candidate_id: str):
    doc = await candidate_service.get_candidate(candidate_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Candidate not found")

    minio_key = (doc.raw_resume_json or {}).get("minio_key")
    if not minio_key:
        raise HTTPException(status_code=404, detail="Resume file not available")

    file_bytes = await minio_service.get_file_bytes(minio_key)
    if file_bytes is None:
        raise HTTPException(status_code=404, detail="Resume file not found in storage")

    filename = (doc.raw_resume_json or {}).get("filename", "resume.pdf")
    is_pdf = filename.lower().endswith(".pdf")
    content_type = "application/pdf" if is_pdf else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    disposition = "inline" if is_pdf else "attachment"

    # RFC 5987: encode filename so Cyrillic / Unicode chars don't crash latin-1 header encoding
    encoded_filename = urlquote(filename, safe="")
    content_disposition = f"{disposition}; filename*=UTF-8''{encoded_filename}"

    return Response(
        content=file_bytes,
        media_type=content_type,
        headers={"Content-Disposition": content_disposition},
    )


async def candidates_by_vacancy(vacancy_id: str):
    docs = await candidate_service.get_candidates_for_vacancy(vacancy_id)
    return [CandidateResponse.from_doc(d) for d in docs]


async def _process_one_file(filename: str, file_bytes: bytes, vacancies: list) -> dict | None:
    """Process a single resume (as raw bytes) against pre-fetched vacancies.

    Returns a result dict on success, or None on failure.
    Errors are logged but never propagated so sibling files still succeed.
    """
    try:
        logger.warning("_process_one_file: filename=%r size=%d", filename, len(file_bytes))
        text = file_service.extract_text(filename, file_bytes)
        logger.warning("_process_one_file: extracted text length=%s", len(text) if text else None)
        if not text:
            logger.warning("_process_one_file: could not extract text from %r, skipping", filename)
            return None

        fields = await ai_service.extract_resume_fields(text)

        sem = asyncio.Semaphore(SCORE_CONCURRENCY)

        async def score_one(v: Vacancy) -> tuple[int, str, list]:
            async with sem:
                return await ai_service.score_candidate(
                    vacancy_title=v.title or "",
                    required_skills=v.skills,
                    experience=v.experience or "",
                    candidate_title=fields.get("title", ""),
                    candidate_skills=fields.get("skills", []),
                    vacancy_description=v.description or "",
                    criteria=v.score_criteria,
                )

        results = await asyncio.gather(*[score_one(v) for v in vacancies])
        scores = [r[0] for r in results]
        best_idx = int(max(range(len(scores)), key=lambda i: scores[i]))
        best_vacancy = vacancies[best_idx]
        best_score, best_reasoning, best_criteria = results[best_idx]

        file_hash = hashlib.md5(file_bytes).hexdigest()[:16]

        minio_key = None
        try:
            minio_key = await minio_service.upload_file(file_bytes, filename)
        except Exception:
            pass

        candidate_data = {
            "vacancy_id": best_vacancy.id,
            "hh_resume_id": f"file:{file_hash}",
            "relevance_score": best_score,
            "skills": fields.get("skills") or [],
            "raw_resume_json": {
                "source": "file",
                "filename": filename,
                "extracted": fields,
                "minio_key": minio_key,
                "score_reasoning": best_reasoning,
                "score_criteria": best_criteria,
            },
            "matched_at": datetime.now(timezone.utc),
            **{k: fields[k] for k in ("first_name", "last_name", "title", "area",
                                       "salary_amount", "salary_currency")
               if fields.get(k)},
        }

        col = Candidate.get_motor_collection()
        upsert_filter = {"vacancy_id": best_vacancy.id, "hh_resume_id": f"file:{file_hash}"}
        upsert_result = await col.update_one(upsert_filter, {"$set": candidate_data}, upsert=True)
        candidate_oid = upsert_result.upserted_id or (
            await col.find_one(upsert_filter, {"_id": 1})
        )["_id"]

        if minio_key:
            resume_url = f"/api/candidates/{candidate_oid}/resume"
            await col.update_one({"_id": candidate_oid}, {"$set": {"resume_url": resume_url}})

        filename_base = filename.rsplit(".", 1)[0] if filename else "Unknown"
        name = " ".join(filter(None, [fields.get("first_name"), fields.get("last_name")])) or fields.get("title") or filename_base
        return {
            "id": str(candidate_oid),
            "name": name,
            "score": best_score,
            "vacancy_title": best_vacancy.title,
            "vacancy_id": str(best_vacancy.id),
        }

    except Exception:
        logger.exception("_process_one_file: unexpected error processing %r", filename)
        return None


# ── Background upload job state ──────────────────────────────────────────────
_upload_job: dict = {
    "status": "idle",   # "idle" | "processing" | "done" | "error"
    "total": 0,
    "processed": 0,
    "results": [],      # list of {id, name, score, vacancy_title, vacancy_id}
    "errors": 0,
    "error": None,
}


async def _run_upload(file_data: list[tuple[str, bytes]], vacancies: list) -> None:
    global _upload_job
    sem = asyncio.Semaphore(3)

    async def process_one(filename: str, file_bytes: bytes) -> None:
        async with sem:
            result = await _process_one_file(filename, file_bytes, vacancies)
            _upload_job["processed"] += 1
            if result:
                _upload_job["results"].append(result)
            else:
                _upload_job["errors"] += 1

    try:
        await asyncio.gather(*[process_one(fn, fb) for fn, fb in file_data])
        _upload_job["status"] = "done"
    except Exception as e:
        logger.exception("Background upload job failed")
        _upload_job.update({"status": "error", "error": str(e)})


async def upload_and_auto_match(
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(...),
) -> dict:
    """Accept resume files, start background processing, return immediately.

    Clients should poll /upload-status for progress and results.
    """
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")
    if _upload_job["status"] == "processing":
        raise HTTPException(status_code=409, detail="Upload already in progress")

    vacancies = await Vacancy.find({"status": VacancyStatus.approved}).to_list()
    if not vacancies:
        raise HTTPException(status_code=422, detail="No approved vacancies to match against")

    # Read all bytes NOW — UploadFile stream closes after response is sent
    file_data: list[tuple[str, bytes]] = []
    for f in files:
        if not f.filename:
            continue
        fb = await f.read()
        if 0 < len(fb) <= 10 * 1024 * 1024:
            file_data.append((f.filename, fb))
        else:
            logger.warning("upload: skipping %r (size=%d)", f.filename, len(fb))

    if not file_data:
        raise HTTPException(status_code=400, detail="No valid files to process (empty or >10 MB)")

    _upload_job.update({
        "status": "processing",
        "total": len(file_data),
        "processed": 0,
        "results": [],
        "errors": 0,
        "error": None,
    })

    background_tasks.add_task(_run_upload, file_data, vacancies)
    return {"status": "started", "total": len(file_data)}


async def upload_status() -> dict:
    """Return current background upload job status."""
    return {
        "status":    _upload_job["status"],
        "total":     _upload_job["total"],
        "processed": _upload_job["processed"],
        "results":   _upload_job["results"],
        "errors":    _upload_job["errors"],
        "error":     _upload_job["error"],
    }


async def import_from_xlsx(file: UploadFile = File(...)):
    """Bulk-import candidates from an Excel internship-application form.

    Reads every row that has an ID and first_name.  Groups candidates by
    internship_name and scores each unique group against all approved
    vacancies once, then inserts all records in bulk.
    Returns { imported, skipped, total }.
    """
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Only .xlsx files are accepted")

    file_bytes = await file.read()
    if len(file_bytes) > 50 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (max 50 MB)")

    rows = file_service.extract_rows_from_xlsx(file_bytes)
    if not rows:
        raise HTTPException(status_code=422, detail="No valid candidate rows found in the file")

    vacancies = await Vacancy.find({"status": VacancyStatus.approved}).to_list()
    if not vacancies:
        raise HTTPException(status_code=422, detail="No approved vacancies to match against")

    # Score each unique internship name once against all vacancies
    unique_internships = list({r["internship_name"] or "" for r in rows})
    sem = asyncio.Semaphore(SCORE_CONCURRENCY)

    async def score_internship(internship_title: str) -> tuple[str, int, int, str, list]:
        """Returns (internship_title, best_vacancy_idx, best_score, reasoning, criteria)."""
        async def score_one(v: Vacancy) -> tuple[int, str, list]:
            async with sem:
                return await ai_service.score_candidate(
                    vacancy_title=v.title or "",
                    required_skills=v.skills,
                    experience=v.experience or "",
                    candidate_title=internship_title,
                    candidate_skills=[],
                    vacancy_description=v.description or "",
                    criteria=v.score_criteria,
                )
        scored = await asyncio.gather(*[score_one(v) for v in vacancies])
        sc_vals = [r[0] for r in scored]
        best_idx = int(max(range(len(sc_vals)), key=lambda i: sc_vals[i]))
        best_score, best_reasoning, best_criteria = scored[best_idx]
        return internship_title, best_idx, best_score, best_reasoning, best_criteria

    results = await asyncio.gather(*[score_internship(t) for t in unique_internships])
    internship_to_vacancy: dict[str, tuple[int, int, str, list]] = {
        title: (idx, score, reasoning, criteria)
        for title, idx, score, reasoning, criteria in results
    }

    now = datetime.now(timezone.utc)
    imported = 0
    skipped = 0
    col = Candidate.get_motor_collection()

    for row in rows:
        internship = row["internship_name"] or ""
        best_idx, best_score, best_reasoning, best_criteria = internship_to_vacancy[internship]
        best_vacancy = vacancies[best_idx]

        hh_id = f"xlsx:{row['row_id']}"
        candidate_data = {
            "vacancy_id": best_vacancy.id,
            "hh_resume_id": hh_id,
            "first_name": row["first_name"],
            "last_name": row["last_name"],
            "title": internship or None,
            "relevance_score": best_score,
            "raw_resume_json": {
                "source": "xlsx",
                "phone": row["phone"],
                "internship_name": internship,
                "comment": row["comment"],
                "score_reasoning": best_reasoning,
                "score_criteria": best_criteria,
            },
            "matched_at": now,
        }

        # Atomic upsert — replaces non-atomic find_one+insert that caused duplicates
        result = await col.update_one(
            {"vacancy_id": best_vacancy.id, "hh_resume_id": hh_id},
            {"$set": candidate_data},
            upsert=True,
        )
        if result.upserted_id:
            imported += 1
        else:
            skipped += 1

    return {"imported": imported, "skipped": skipped, "total": len(rows)}


async def explain_score(candidate_id: str):
    """Generate (or regenerate) score reasoning for a candidate via LLM and persist it."""
    doc = await candidate_service.get_candidate(candidate_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Candidate not found")

    vacancy = await Vacancy.find_one({"_id": doc.vacancy_id})
    if not vacancy:
        raise HTTPException(status_code=404, detail="Matched vacancy not found")

    candidate_title = doc.title or ""
    candidate_skills = doc.skills or []
    raw: dict = doc.raw_resume_json or {}

    # Use internship_name from xlsx source if available
    if raw.get("source") == "xlsx":
        candidate_title = raw.get("internship_name") or candidate_title

    new_score, reasoning, criteria = await ai_service.score_candidate(
        vacancy_title=vacancy.title or "",
        required_skills=vacancy.skills,
        experience=vacancy.experience or "",
        candidate_title=candidate_title,
        candidate_skills=candidate_skills,
        vacancy_description=vacancy.description or "",
        criteria=vacancy.score_criteria,
    )

    # Persist new score + reasoning + criteria
    raw["score_reasoning"] = reasoning
    raw["score_criteria"] = criteria
    doc.raw_resume_json = raw
    doc.relevance_score = new_score
    await doc.save()

    return {"reasoning": reasoning, "criteria": criteria, "score": new_score}


# ── Bulk rescore job state (in-process; single uvicorn worker) ──────────────
_rescore_job: dict = {
    "status": "idle", "total": 0, "processed": 0, "updated": 0,
    "error": None, "done_keys": set(),   # tracks completed internship keys for resume
}


async def _run_rescore(resume: bool = False) -> None:
    global _rescore_job
    if not resume:
        _rescore_job.update({"status": "running", "processed": 0, "updated": 0,
                             "error": None, "done_keys": set()})
    else:
        # Resume: keep done_keys and counters, just flip status back to running
        _rescore_job.update({"status": "running", "error": None})

    try:
        vacancies = await Vacancy.find({"status": VacancyStatus.approved}).to_list()
        if not vacancies:
            _rescore_job.update({"status": "done", "error": "No approved vacancies"})
            return

        # ── 1. xlsx candidates: group by internship_name ──────────────────────
        pipeline = [
            {"$match": {"raw_resume_json.source": "xlsx"}},
            {"$group": {
                "_id": "$raw_resume_json.internship_name",
                "candidate_ids": {"$push": {"$toString": "$_id"}},
                "skills": {"$first": "$skills"},
            }},
        ]
        groups = await Candidate.get_motor_collection().aggregate(pipeline).to_list(None)

        # ── 2. non-xlsx candidates (file / hh): score individually ────────────
        non_xlsx = await Candidate.find(
            {"raw_resume_json.source": {"$in": ["file", "hh"]}}
        ).to_list()

        total = len(groups) + len(non_xlsx)
        _rescore_job["total"] = total
        updated = 0
        sem = asyncio.Semaphore(SCORE_CONCURRENCY)

        # helper: score one title against all vacancies (uses each vacancy's own weights)
        async def best_score_for(title: str, skills: list) -> tuple[int, str, list, object]:
            async def _one(v: Vacancy) -> tuple[int, str, list]:
                async with sem:
                    return await ai_service.score_candidate(
                        vacancy_title=v.title or "",
                        required_skills=v.skills,
                        experience=v.experience or "",
                        candidate_title=title,
                        candidate_skills=skills,
                        vacancy_description=v.description or "",
                        criteria=v.score_criteria,
                    )
            results = await asyncio.gather(*[_one(v) for v in vacancies])
            scores = [r[0] for r in results]
            best_idx = int(max(range(len(scores)), key=lambda i: scores[i]))
            sc, rs, cr = results[best_idx]
            return sc, rs, cr, vacancies[best_idx]

        from bson import ObjectId

        updated = _rescore_job["updated"]  # carry over on resume

        # ── Score xlsx groups ──────────────────────────────────────────────────
        for group in groups:
            internship = group["_id"] or ""
            group_key = f"xlsx::{internship}"

            # Resume: skip already-processed groups
            if group_key in _rescore_job["done_keys"]:
                continue

            skills = group.get("skills") or []
            candidate_ids = group["candidate_ids"]

            sc, rs, cr, best_vacancy = await best_score_for(internship, skills)

            col = Candidate.get_motor_collection()
            oids = [ObjectId(cid) for cid in candidate_ids]
            res = await col.update_many(
                {"_id": {"$in": oids}},
                {"$set": {
                    "relevance_score": sc,
                    "vacancy_id": best_vacancy.id,
                    "raw_resume_json.score_reasoning": rs,
                    "raw_resume_json.score_criteria": cr,
                }},
            )
            updated += res.modified_count
            _rescore_job["done_keys"].add(group_key)
            _rescore_job["processed"] += 1
            _rescore_job["updated"] = updated

        # ── Score non-xlsx individually ────────────────────────────────────────
        for doc in non_xlsx:
            doc_key = f"doc::{doc.id}"
            if doc_key in _rescore_job["done_keys"]:
                continue

            title = doc.title or ""
            skills = doc.skills or []
            raw = doc.raw_resume_json or {}
            if raw.get("source") == "file":
                extracted = raw.get("extracted") or {}
                title = extracted.get("title") or title
                skills = extracted.get("skills") or skills

            sc, rs, cr, _best_vacancy = await best_score_for(title, skills)

            # Use direct update_one to avoid DuplicateKeyError on the
            # (vacancy_id, hh_resume_id) unique compound index.
            # We intentionally do NOT change vacancy_id here — only update
            # the score + reasoning so the rescore never violates the index.
            col = Candidate.get_motor_collection()
            await col.update_one(
                {"_id": doc.id},
                {"$set": {
                    "relevance_score": sc,
                    "raw_resume_json.score_reasoning": rs,
                    "raw_resume_json.score_criteria": cr,
                }},
            )
            updated += 1
            _rescore_job["done_keys"].add(doc_key)
            _rescore_job["processed"] += 1
            _rescore_job["updated"] = updated

        _rescore_job.update({"status": "done", "updated": updated})

    except Exception as e:
        logger.exception("Bulk rescore failed")
        _rescore_job.update({"status": "error", "error": str(e)})


async def rescore_all(background_tasks: BackgroundTasks, resume: bool = Query(False)):
    """Start (or resume) bulk re-scoring of all candidates in background."""
    if _rescore_job["status"] == "running":
        raise HTTPException(status_code=409, detail="Rescore already running")
    can_resume = resume and _rescore_job["status"] in ("error", "done") and _rescore_job.get("done_keys")
    background_tasks.add_task(_run_rescore, resume=bool(can_resume))
    return {"status": "resumed" if can_resume else "started"}


async def rescore_status():
    """Return current bulk rescore job status."""
    return {
        "status":     _rescore_job["status"],
        "total":      _rescore_job["total"],
        "processed":  _rescore_job["processed"],
        "updated":    _rescore_job["updated"],
        "error":      _rescore_job["error"],
        "can_resume": (
            _rescore_job["status"] in ("error",)
            and bool(_rescore_job.get("done_keys"))
        ),
    }


class BulkDeleteBody(BaseModel):
    ids: List[str]


async def delete_candidate(candidate_id: str):
    doc = await candidate_service.get_candidate(candidate_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Candidate not found")
    await doc.delete()
    return {"ok": True}


async def delete_candidates_bulk(body: BulkDeleteBody):
    from bson import ObjectId
    col = Candidate.get_motor_collection()
    oids = [ObjectId(cid) for cid in body.ids if cid]
    result = await col.delete_many({"_id": {"$in": oids}})
    return {"deleted": result.deleted_count}


_vectorize_job: dict = {"status": "idle", "total": 0, "processed": 0, "vectorized": 0, "error": None}


async def vectorize_all():
    """Embed all MongoDB candidates and upsert to permanent Qdrant collection."""
    global _vectorize_job
    if _vectorize_job["status"] == "running":
        raise HTTPException(status_code=409, detail="Vectorize already running")

    _vectorize_job = {"status": "running", "total": 0, "processed": 0, "vectorized": 0, "error": None}

    async def _run() -> None:
        global _vectorize_job
        try:
            from app.database import get_qdrant
            from app.config import settings
            from app.services.embedding_service import embed_batch
            from app.services.qdrant_service import upsert_items_to_temp_collection

            all_docs = await Candidate.find().to_list()
            seen: set[str] = set()
            unique: list = []
            for c in all_docs:
                if c.hh_resume_id not in seen:
                    seen.add(c.hh_resume_id)
                    unique.append(c)

            _vectorize_job["total"] = len(unique)

            texts: list[str] = []
            for c in unique:
                title = c.title or ""
                skills = c.skills or []
                raw = c.raw_resume_json or {}
                if raw.get("source") == "file":
                    ext = raw.get("extracted") or {}
                    title = ext.get("title") or title
                    skills = ext.get("skills") or skills
                text = f"{title}. Skills: {', '.join(skills[:15])}" if title else ", ".join(skills[:15])
                texts.append(text)

            vectors = await embed_batch(texts, concurrency=8)

            qdrant_items: list[dict] = []
            valid_vectors: list[list[float]] = []
            valid_resume_ids: list[str] = []
            for c, vector in zip(unique, vectors):
                if not vector:
                    continue
                qdrant_items.append({
                    "id": f"db:{c.hh_resume_id}",
                    "hh_resume_id": c.hh_resume_id,
                    "title": c.title or "",
                    "skills": c.skills or [],
                    "area": c.area or "",
                    "salary_amount": c.salary_amount,
                    "salary_currency": c.salary_currency or "",
                    "source": "db",
                    "first_name": c.first_name or "",
                    "last_name": c.last_name or "",
                })
                valid_vectors.append(vector)
                valid_resume_ids.append(c.hh_resume_id)

            qdrant = await get_qdrant()
            await upsert_items_to_temp_collection(qdrant, settings.qdrant_collection, qdrant_items, valid_vectors)

            col = Candidate.get_motor_collection()
            for rid in valid_resume_ids:
                await col.update_many(
                    {"hh_resume_id": rid},
                    {"$set": {"is_vectorized": True}},
                )
                _vectorize_job["vectorized"] += 1
            _vectorize_job["processed"] = len(unique)
            _vectorize_job["status"] = "done"

        except Exception as exc:
            logger.error("vectorize_all error: %s", exc, exc_info=True)
            _vectorize_job["status"] = "error"
            _vectorize_job["error"] = str(exc)

    asyncio.create_task(_run())
    return {"status": "started"}


async def vectorize_status():
    return dict(_vectorize_job)


router.add_api_route("/", list_candidates, methods=["GET"])
router.add_api_route("/rescore-all", rescore_all, methods=["POST"])
router.add_api_route("/rescore-status", rescore_status, methods=["GET"])
router.add_api_route("/vectorize-all", vectorize_all, methods=["POST"])
router.add_api_route("/vectorize-status", vectorize_status, methods=["GET"])
router.add_api_route("/upload", upload_and_auto_match, methods=["POST"])
router.add_api_route("/upload-status", upload_status, methods=["GET"])
router.add_api_route("/import-xlsx", import_from_xlsx, methods=["POST"])
router.add_api_route("/bulk", delete_candidates_bulk, methods=["DELETE"])
router.add_api_route("/vacancy/{vacancy_id}", candidates_by_vacancy, methods=["GET"])
router.add_api_route("/{candidate_id}/explain-score", explain_score, methods=["POST"])
router.add_api_route("/{candidate_id}/resume", get_candidate_resume, methods=["GET"])
router.add_api_route("/{candidate_id}", get_candidate, methods=["GET"])
router.add_api_route("/{candidate_id}", delete_candidate, methods=["DELETE"])
