from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import pymongo
from beanie import PydanticObjectId

from app.models.candidate import Candidate
from app.models.vacancy import Vacancy


def _parse_candidate(vacancy_id: PydanticObjectId, resume: Dict[str, Any], relevance_score: Optional[int] = None) -> Dict:
    salary_raw = resume.get("salary")
    salary = salary_raw if isinstance(salary_raw, dict) else {}
    photo_raw = resume.get("photo")
    photo = photo_raw if isinstance(photo_raw, dict) else {}

    # salary may be stored as int (cleverstaff) or dict {"amount":..,"currency":..} (hh.uz)
    if isinstance(salary_raw, (int, float)):
        salary_amount = salary_raw
        salary_currency = resume.get("currency")
    else:
        salary_amount = salary.get("amount")
        salary_currency = salary.get("currency")

    # area may be a dict {"name":..} (hh.uz) or a plain string (cleverstaff "region")
    area_raw = resume.get("area")
    if isinstance(area_raw, dict):
        area = area_raw.get("name")
    else:
        area = area_raw or resume.get("region")

    # gender may be a dict {"id":..} (hh.uz) or a string
    gender_raw = resume.get("gender")
    gender = gender_raw.get("id") if isinstance(gender_raw, dict) else gender_raw

    # title: prefer hh.uz "title", fall back to cleverstaff "position"
    title = resume.get("title") or resume.get("position") or resume.get("current_position")

    # hh_resume_id: hh.uz uses "id", cleverstaff uses "candidate_id"
    hh_resume_id = resume.get("id") or resume.get("candidate_id") or ""

    skills_raw = resume.get("skill_set") or resume.get("skills") or []
    skills = [s if isinstance(s, str) else s.get("name", "") for s in skills_raw]

    return {
        "vacancy_id": vacancy_id,
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
        "relevance_score": relevance_score,
        "raw_resume_json": resume,
        "matched_at": datetime.now(timezone.utc),
    }


async def replace_candidates(vacancy: Vacancy, scored_resumes: List[tuple]) -> int:
    """Upsert candidates: update existing by hh_resume_id, insert new ones."""
    from pymongo import UpdateOne

    collection = Candidate.get_motor_collection()
    ops = []
    matched_hh_ids = []
    for resume, score in scored_resumes:
        data = _parse_candidate(vacancy.id, resume, relevance_score=score)
        if not data["hh_resume_id"]:
            continue
        matched_hh_ids.append(data["hh_resume_id"])
        ops.append(
            UpdateOne(
                # Match either an existing vacancy match OR a pool copy (vacancy_id=None).
                # This converts a file-uploaded candidate in-place instead of creating a duplicate.
                {"hh_resume_id": data["hh_resume_id"], "vacancy_id": {"$in": [None, vacancy.id]}},
                {"$set": data},
                upsert=True,
            )
        )
    if not ops:
        return 0
    result = await collection.bulk_write(ops, ordered=False)
    return result.upserted_count + result.modified_count


async def get_candidates_for_vacancy(vacancy_id: str) -> List[Candidate]:
    oid = PydanticObjectId(vacancy_id)
    return await Candidate.find({"vacancy_id": oid}).sort("-matched_at").to_list()


async def get_all_candidates(
    skip: int = 0,
    limit: int = 20,
    vacancy_id: Optional[str] = None,
    search: Optional[str] = None,
    sort_by: str = "score",       # "score" | "date" | "name"
    source: Optional[str] = None, # "xlsx" | "file" | "hh" | "cleverstaff" | None
):
    query: dict = {}
    if vacancy_id:
        query["vacancy_id"] = PydanticObjectId(vacancy_id)
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
        "score": [("relevance_score", pymongo.DESCENDING), ("matched_at", pymongo.DESCENDING)],
        "date":  [("matched_at", pymongo.DESCENDING)],
        "name":  [("first_name", pymongo.ASCENDING), ("last_name", pymongo.ASCENDING)],
    }
    sort_spec = _SORT.get(sort_by, _SORT["score"])
    sort_stage = {k: v for k, v in sort_spec}

    if vacancy_id:
        # Specific vacancy filter — no dedup needed, return as-is
        total = await Candidate.find(query).count()
        items = await Candidate.find(query).skip(skip).limit(limit).sort(sort_spec).to_list()
        return items, total

    # No vacancy filter: deduplicate by hh_resume_id so pool (vacancy_id=None) and
    # matched (vacancy_id=X) copies of the same candidate appear only once.
    # $first after sorting picks the matched/scored record over the pool copy.
    col = Candidate.get_motor_collection()
    pipeline = [
        {"$match": query},
        {"$sort": sort_stage},
        {"$group": {
            "_id": "$hh_resume_id",
            "doc": {"$first": "$$ROOT"},
        }},
        {"$replaceRoot": {"newRoot": "$doc"}},
        {"$sort": sort_stage},
        {"$facet": {
            "total": [{"$count": "count"}],
            "items": [{"$skip": skip}, {"$limit": limit}],
        }},
    ]
    result = await col.aggregate(pipeline).to_list(1)
    if not result:
        return [], 0
    total = result[0]["total"][0]["count"] if result[0].get("total") else 0
    raw_items = result[0].get("items", [])
    items = []
    for raw in raw_items:
        try:
            raw["id"] = raw.pop("_id", None)
            items.append(Candidate.model_validate(raw))
        except Exception:
            pass
    return items, total


async def get_candidate(candidate_id: str) -> Optional[Candidate]:
    return await Candidate.get(PydanticObjectId(candidate_id))
