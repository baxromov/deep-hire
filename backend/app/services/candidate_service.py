import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import pymongo
from beanie import PydanticObjectId

from app.database import get_qdrant
from app.models.candidate import Candidate
from app.models.match_candidate_hit import MatchCandidateHit
from app.models.match_result import MatchResult
from app.models.vacancy import Vacancy
from app.services import qdrant_service
from app.services.embedding_service import build_resume_text, embed

logger = logging.getLogger(__name__)

# Cosine-similarity floor for treating a fresh HH search hit as "already in our DB"
# (same resume vectorized previously via CleverStaff sync / vectorize-all / a prior save).
HH_DEDUP_SCORE_THRESHOLD = 0.95


def _parse_candidate(resume: Dict[str, Any]) -> Dict:
    """Parse resume dict into candidate field dict (person data only, no vacancy context)."""
    salary_raw = resume.get("salary")
    salary = salary_raw if isinstance(salary_raw, dict) else {}
    photo_raw = resume.get("photo")
    photo = photo_raw if isinstance(photo_raw, dict) else {}

    if isinstance(salary_raw, (int, float)):
        salary_amount = salary_raw
        salary_currency = resume.get("currency")
    else:
        salary_amount = salary.get("amount")
        salary_currency = salary.get("currency")

    area_raw = resume.get("area")
    if isinstance(area_raw, dict):
        area = area_raw.get("name")
    else:
        area = area_raw or resume.get("region")

    gender_raw = resume.get("gender")
    gender = gender_raw.get("id") if isinstance(gender_raw, dict) else gender_raw

    title = resume.get("title") or resume.get("position") or resume.get("current_position")

    hh_resume_id = resume.get("id") or ""
    if not hh_resume_id and resume.get("candidate_id"):
        # CleverStaff-shaped resumes only carry "candidate_id" (their own native id, no
        # "cs:" prefix) — prefix it to match sync_service's convention so this resume
        # dedupes against the already-synced Candidate instead of becoming a duplicate.
        prefix = "cs:" if resume.get("source") == "cleverstaff" else ""
        hh_resume_id = f"{prefix}{resume['candidate_id']}"

    skills_raw = resume.get("skill_set") or resume.get("skills") or []
    # HH-shaped skill dicts use "name"; CleverStaff-shaped ones use "skill".
    skills = [
        s if isinstance(s, str) else (s.get("name") or s.get("skill") or "")
        for s in skills_raw
    ]

    return {
        "hh_resume_id": hh_resume_id,
        "first_name": resume.get("first_name"),
        "last_name": resume.get("last_name"),
        "age": resume.get("age"),
        "gender": gender,
        "area": area,
        "title": title,
        "salary_amount": salary_amount,
        "salary_currency": salary_currency,
        "skills": skills,
        "photo_url": photo.get("medium") if photo else None,
        "resume_url": resume.get("alternate_url") or resume.get("resume_url"),
        "raw_resume_json": resume,
    }


async def _link_or_stage(
    vacancy: Vacancy,
    resume: Dict[str, Any],
    score: int,
    existing_candidate_id: Optional[str],
    source: str,
    mr_col,
    hit_col,
    now: datetime,
    existing_hh_resume_id: Optional[str] = None,
    matched_by: Optional[str] = None,
    matched_by_name: Optional[str] = None,
) -> str:
    """Write one scored resume as either a MatchResult link (existing_candidate_id known)
    or a MatchCandidateHit staging row (candidate_id unknown — never touches Candidate).

    When linking, the MatchResult MUST be keyed on the existing Candidate's own
    hh_resume_id (existing_hh_resume_id) — not this resume's hh_resume_id, which can
    differ (e.g. a CleverStaff-synced "cs:123" person resurfacing in a fresh HH.ru
    search as "hh:456"). Getting this wrong silently breaks the join that renders the
    row in the UI (name/skills/resume/score all vanish) even though the link succeeded.

    Returns "linked" or "staged", or "" if the resume has no hh_resume_id to key on.
    """
    data = _parse_candidate(resume)
    if not data["hh_resume_id"]:
        return ""

    score_fields = {
        "relevance_score": score,
        "vector_score": resume.get("_vector_score"),
        "llm_score": resume.get("_llm_score"),
        "score_reasoning": resume.get("score_reasoning"),
        "score_criteria": resume.get("score_criteria") or [],
        "matched_at": now,
        "matched_by": matched_by,
        "matched_by_name": matched_by_name,
    }

    if existing_candidate_id:
        # Already a real candidate — link the score, don't touch Candidate/staging.
        hh_resume_id = existing_hh_resume_id or data["hh_resume_id"]
        await mr_col.update_one(
            {"vacancy_id": vacancy.id, "hh_resume_id": hh_resume_id},
            {"$set": {
                "vacancy_id": vacancy.id,
                "candidate_id": PydanticObjectId(existing_candidate_id),
                "hh_resume_id": hh_resume_id,
                "source": source,
                **score_fields,
            }},
            upsert=True,
        )
        return "linked"

    await hit_col.update_one(
        {"vacancy_id": vacancy.id, "hh_resume_id": data["hh_resume_id"]},
        {"$set": {**data, "vacancy_id": vacancy.id, "source": source, **score_fields}},
        upsert=True,
    )
    return "staged"


async def stage_hh_hits(
    vacancy: Vacancy, scored_resumes: List[tuple], source: str = "hh",
    matched_by: Optional[str] = None, matched_by_name: Optional[str] = None,
) -> Dict[str, int]:
    """Persist fresh HH.ru search hits without polluting the permanent Candidate collection.

    Each hit is checked against the permanent Qdrant pool by re-embedding it: a
    near-identical vector (>= HH_DEDUP_SCORE_THRESHOLD) means this person is already
    a real Candidate (e.g. synced from CleverStaff, or saved from an earlier search)
    — see _link_or_stage. Use this for resumes fetched live from HH.ru, where we
    don't yet know if the person is already in our DB.
    """
    qdrant = await get_qdrant()
    await qdrant_service.ensure_collection(qdrant)

    mr_col = MatchResult.get_motor_collection()
    hit_col = MatchCandidateHit.get_motor_collection()
    now = datetime.now(timezone.utc)
    counts = {"linked": 0, "staged": 0}

    for resume, score in scored_resumes:
        vector = await embed(build_resume_text(resume))
        existing = await qdrant_service.search_candidates(
            qdrant, vector, top_k=1, score_threshold=HH_DEDUP_SCORE_THRESHOLD,
        ) if vector else []
        existing_candidate_id = existing[0].get("candidate_id") if existing else None
        existing_hh_resume_id = existing[0].get("hh_resume_id") if existing else None

        outcome = await _link_or_stage(
            vacancy, resume, score, existing_candidate_id, source, mr_col, hit_col, now,
            existing_hh_resume_id, matched_by, matched_by_name,
        )
        if outcome:
            counts[outcome] += 1

    return counts


async def stage_pool_hits(
    vacancy: Vacancy, scored_resumes: List[tuple], source: str,
    matched_by: Optional[str] = None, matched_by_name: Optional[str] = None,
) -> Dict[str, int]:
    """Persist permanent-pool search hits (db_search/talent_pool) without polluting Candidate.

    Unlike stage_hh_hits, each resume here was already retrieved from a Qdrant hit in
    the permanent pool, so its candidate_id (if any) is already known — pass it through
    via resume["_candidate_id"] instead of re-embedding/re-searching. A resume with no
    candidate_id came from a source that never created a Mongo Candidate (e.g. raw
    talent-pool ingestion) and must be staged, not silently turned into a new Candidate.
    """
    mr_col = MatchResult.get_motor_collection()
    hit_col = MatchCandidateHit.get_motor_collection()
    now = datetime.now(timezone.utc)
    counts = {"linked": 0, "staged": 0}

    for resume, score in scored_resumes:
        outcome = await _link_or_stage(
            vacancy, resume, score, resume.get("_candidate_id"), source, mr_col, hit_col, now,
            None, matched_by, matched_by_name,
        )
        if outcome:
            counts[outcome] += 1

    return counts


async def get_candidates_for_vacancy(
    vacancy_id: str,
) -> List[Tuple[Candidate, MatchResult]]:
    """Return (Candidate, MatchResult) pairs for a vacancy, sorted by relevance_score desc."""
    oid = PydanticObjectId(vacancy_id)
    match_results = await MatchResult.find({"vacancy_id": oid}).to_list()
    if not match_results:
        return []

    hh_ids = [mr.hh_resume_id for mr in match_results]
    candidates = await Candidate.find({"hh_resume_id": {"$in": hh_ids}}).to_list()
    cand_by_hh = {c.hh_resume_id: c for c in candidates}

    pairs = [
        (cand_by_hh[mr.hh_resume_id], mr)
        for mr in match_results
        if mr.hh_resume_id in cand_by_hh
    ]
    pairs.sort(key=lambda x: (x[1].relevance_score or 0), reverse=True)
    return pairs


async def get_combined_pool_for_vacancy(vacancy_id: str) -> List[Dict[str, Any]]:
    """Gather every candidate already found for this vacancy by any method — real
    Candidate docs (via MatchResult) plus still-unconfirmed MatchCandidateHit rows —
    deduped by hh_resume_id (a real Candidate wins over a staged hit for the same
    person). Used for a combined re-ranking pass: each dict carries what's needed
    to re-score (title/skills/work_experience) and to re-persist a new MatchResult
    (candidate_id known) or MatchCandidateHit (only _hit_fields known) row.
    """
    oid = PydanticObjectId(vacancy_id)
    pool: Dict[str, Dict[str, Any]] = {}

    hits = await MatchCandidateHit.find({"vacancy_id": oid}).to_list()
    for hit in hits:
        raw = hit.raw_resume_json or {}
        work_exp = raw.get("work_experience") or raw.get("extracted", {}).get("experience") or []
        pool[hit.hh_resume_id] = {
            "hh_resume_id": hit.hh_resume_id,
            "candidate_id": None,
            "title": hit.title,
            "skills": hit.skills,
            "work_experience": work_exp,
            "prior_score": hit.relevance_score or hit.llm_score or hit.vector_score or 0,
            "_hit_fields": {
                "first_name": hit.first_name, "last_name": hit.last_name, "age": hit.age,
                "gender": hit.gender, "area": hit.area, "title": hit.title,
                "salary_amount": hit.salary_amount, "salary_currency": hit.salary_currency,
                "skills": hit.skills, "photo_url": hit.photo_url, "resume_url": hit.resume_url,
                "raw_resume_json": hit.raw_resume_json,
            },
        }

    pairs = await get_candidates_for_vacancy(vacancy_id)
    for doc, mr in pairs:
        raw = doc.raw_resume_json or {}
        work_exp = raw.get("work_experience") or raw.get("extracted", {}).get("experience") or []
        pool[doc.hh_resume_id] = {  # real Candidate wins over any staged hit sharing the id
            "hh_resume_id": doc.hh_resume_id,
            "candidate_id": str(doc.id),
            "title": doc.title,
            "skills": doc.skills,
            "work_experience": work_exp,
            "prior_score": mr.relevance_score or mr.llm_score or mr.vector_score or 0,
            "_hit_fields": None,
        }

    return list(pool.values())


async def get_all_candidates(
    skip: int = 0,
    limit: int = 20,
    vacancy_id: Optional[str] = None,
    search: Optional[str] = None,
    sort_by: str = "score",
    source: Optional[str] = None,
) -> Tuple[List, int]:
    """Return (items, total) where items are (Candidate, Optional[MatchResult]) tuples."""
    if vacancy_id:
        oid = PydanticObjectId(vacancy_id)
        match_results = await MatchResult.find({"vacancy_id": oid}).to_list()
        if not match_results:
            return [], 0

        hh_ids = [mr.hh_resume_id for mr in match_results]
        # Only saved (confirmed) candidates belong in the global candidate database view —
        # unconfirmed HH matches live only in the per-vacancy matched list until saved.
        cand_query: dict = {"hh_resume_id": {"$in": hh_ids}, "is_saved": {"$ne": False}}
        if source:
            cand_query["raw_resume_json.source"] = source
        if search:
            import re
            pattern = re.compile(re.escape(search), re.IGNORECASE)
            cand_query["$or"] = [
                {"title": {"$regex": pattern}},
                {"first_name": {"$regex": pattern}},
                {"last_name": {"$regex": pattern}},
                {"area": {"$regex": pattern}},
                {"skills": {"$regex": pattern}},
            ]

        candidates = await Candidate.find(cand_query).to_list()
        cand_by_hh = {c.hh_resume_id: c for c in candidates}
        mr_by_hh = {mr.hh_resume_id: mr for mr in match_results}

        pairs = [
            (cand_by_hh[hh], mr_by_hh[hh])
            for hh in cand_by_hh
            if hh in mr_by_hh
        ]

        if sort_by == "score":
            pairs.sort(key=lambda x: (x[1].relevance_score or 0), reverse=True)
        elif sort_by == "date":
            pairs.sort(key=lambda x: x[1].matched_at, reverse=True)
        elif sort_by == "name":
            pairs.sort(key=lambda x: (x[0].first_name or "", x[0].last_name or ""))

        total = len(pairs)
        return pairs[skip : skip + limit], total

    # No vacancy filter: simple Candidate list, return without MatchResult
    query: dict = {"is_saved": {"$ne": False}}
    if source:
        query["raw_resume_json.source"] = source
    if search:
        import re
        pattern = re.compile(re.escape(search), re.IGNORECASE)
        query["$or"] = [
            {"title": {"$regex": pattern}},
            {"first_name": {"$regex": pattern}},
            {"last_name": {"$regex": pattern}},
            {"area": {"$regex": pattern}},
            {"skills": {"$regex": pattern}},
        ]

    _SORT = {
        "score": [("_id", pymongo.DESCENDING)],
        "date":  [("_id", pymongo.DESCENDING)],
        "name":  [("first_name", pymongo.ASCENDING), ("last_name", pymongo.ASCENDING)],
    }
    sort_spec = _SORT.get(sort_by, _SORT["score"])

    total = await Candidate.find(query).count()
    items = await Candidate.find(query).skip(skip).limit(limit).sort(sort_spec).to_list()
    return [(c, None) for c in items], total


async def get_candidate(candidate_id: str) -> Optional[Candidate]:
    return await Candidate.get(PydanticObjectId(candidate_id))


async def get_candidate_or_hit(candidate_id: str):
    """Look up a real Candidate first, then fall back to a staged (unsaved) MatchCandidateHit.

    Lets detail/resume/score-explain views work for HH search results that haven't
    been confirmed into the permanent database yet.
    """
    oid = PydanticObjectId(candidate_id)
    doc = await Candidate.get(oid)
    if doc:
        return doc
    return await MatchCandidateHit.get(oid)


async def save_candidate(candidate_id: str) -> Optional[Candidate]:
    """Confirm an unconfirmed candidate into the permanent candidate database.

    `candidate_id` may be a real Candidate._id (legacy is_saved=False row — just
    flip the flag) or a MatchCandidateHit._id (staged HH search hit — promote it
    into a real Candidate, index it in the permanent Qdrant pool, link the
    MatchResult, then drop the staging row).
    """
    doc = await Candidate.get(PydanticObjectId(candidate_id))
    if doc:
        if not doc.is_saved:
            doc.is_saved = True
            await doc.save()
        return doc

    hit = await MatchCandidateHit.get(PydanticObjectId(candidate_id))
    if not hit:
        return None

    cand_col = Candidate.get_motor_collection()
    fields = {
        "hh_resume_id": hit.hh_resume_id,
        "first_name": hit.first_name,
        "last_name": hit.last_name,
        "age": hit.age,
        "gender": hit.gender,
        "area": hit.area,
        "title": hit.title,
        "salary_amount": hit.salary_amount,
        "salary_currency": hit.salary_currency,
        "skills": hit.skills,
        "photo_url": hit.photo_url,
        "resume_url": hit.resume_url,
        "raw_resume_json": hit.raw_resume_json,
    }
    await cand_col.update_one(
        {"hh_resume_id": hit.hh_resume_id},
        {"$set": {**fields, "is_saved": True}},
        upsert=True,
    )
    new_doc = await Candidate.find_one({"hh_resume_id": hit.hh_resume_id})

    try:
        vector = await embed(build_resume_text(hit.raw_resume_json or fields))
        if vector:
            qdrant = await get_qdrant()
            await qdrant_service.ensure_collection(qdrant)
            resume_for_index = {**(hit.raw_resume_json or {}), "id": hit.hh_resume_id}
            await qdrant_service.upsert_candidates(
                qdrant, [resume_for_index], [vector], [str(new_doc.id)],
            )
    except Exception as exc:
        logger.warning("save_candidate: Qdrant indexing failed for %s (non-fatal): %s", hit.hh_resume_id, exc)

    mr_col = MatchResult.get_motor_collection()
    await mr_col.update_one(
        {"vacancy_id": hit.vacancy_id, "hh_resume_id": hit.hh_resume_id},
        {"$set": {
            "vacancy_id": hit.vacancy_id,
            "candidate_id": new_doc.id,
            "hh_resume_id": hit.hh_resume_id,
            "relevance_score": hit.relevance_score,
            "vector_score": hit.vector_score,
            "llm_score": hit.llm_score,
            "score_reasoning": hit.score_reasoning,
            "score_criteria": hit.score_criteria,
            "source": "hh",
            "matched_at": hit.matched_at,
        }},
        upsert=True,
    )
    await hit.delete()
    return new_doc
