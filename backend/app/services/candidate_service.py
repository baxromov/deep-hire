from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import pymongo
from beanie import PydanticObjectId

from app.models.candidate import Candidate
from app.models.match_result import MatchResult
from app.models.vacancy import Vacancy


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
    hh_resume_id = resume.get("id") or resume.get("candidate_id") or ""

    skills_raw = resume.get("skill_set") or resume.get("skills") or []
    skills = [s if isinstance(s, str) else s.get("name", "") for s in skills_raw]

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


async def replace_candidates(vacancy: Vacancy, scored_resumes: List[tuple]) -> int:
    """Upsert Candidates (person data) and MatchResults (vacancy-specific scores).

    Candidate is keyed by hh_resume_id only — person record, never touched for vacancy context.
    MatchResult is keyed by (vacancy_id, hh_resume_id) — score and criteria per vacancy match.
    """
    from pymongo import UpdateOne

    cand_col = Candidate.get_motor_collection()
    mr_col = MatchResult.get_motor_collection()
    now = datetime.now(timezone.utc)

    parsed = []
    for resume, score in scored_resumes:
        data = _parse_candidate(resume)
        if not data["hh_resume_id"]:
            continue
        parsed.append((data, score, resume))

    if not parsed:
        return 0

    # 1. Upsert Candidates by hh_resume_id (person data only, no vacancy context)
    cand_ops = [
        UpdateOne(
            {"hh_resume_id": d["hh_resume_id"]},
            {"$set": d},
            upsert=True,
        )
        for d, _, _ in parsed
    ]
    await cand_col.bulk_write(cand_ops, ordered=False)

    # 2. Fetch candidate _ids for MatchResult foreign key
    hh_ids = [d["hh_resume_id"] for d, _, _ in parsed]
    cands = await cand_col.find(
        {"hh_resume_id": {"$in": hh_ids}},
        {"_id": 1, "hh_resume_id": 1},
    ).to_list(None)
    hh_to_id = {c["hh_resume_id"]: c["_id"] for c in cands}

    # 3. Upsert MatchResults by (vacancy_id, hh_resume_id)
    mr_ops = []
    for data, score, resume in parsed:
        hh_id = data["hh_resume_id"]
        cand_id = hh_to_id.get(hh_id)
        if not cand_id:
            continue
        source = resume.get("_source") or resume.get("source") or "db_search"
        mr_ops.append(
            UpdateOne(
                {"vacancy_id": vacancy.id, "hh_resume_id": hh_id},
                {"$set": {
                    "vacancy_id": vacancy.id,
                    "candidate_id": cand_id,
                    "hh_resume_id": hh_id,
                    "relevance_score": score,
                    "score_reasoning": resume.get("score_reasoning"),
                    "score_criteria": resume.get("score_criteria") or [],
                    "source": source,
                    "matched_at": now,
                }},
                upsert=True,
            )
        )

    if not mr_ops:
        return 0
    result = await mr_col.bulk_write(mr_ops, ordered=False)
    return result.upserted_count + result.modified_count


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
        cand_query: dict = {"hh_resume_id": {"$in": hh_ids}}
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
    query: dict = {}
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
