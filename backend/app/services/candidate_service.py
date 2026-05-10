from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import pymongo
from beanie import PydanticObjectId

from app.models.candidate import Candidate
from app.models.vacancy import Vacancy


def _parse_candidate(vacancy_id: PydanticObjectId, resume: Dict[str, Any], relevance_score: Optional[int] = None) -> Dict:
    salary = resume.get("salary") or {}
    photo = resume.get("photo") or {}
    return {
        "vacancy_id": vacancy_id,
        "hh_resume_id": resume.get("id", ""),
        "first_name": resume.get("first_name"),
        "last_name": resume.get("last_name"),
        "age": resume.get("age"),
        "gender": (resume.get("gender") or {}).get("id"),
        "area": (resume.get("area") or {}).get("name"),
        "title": resume.get("title"),
        "salary_amount": salary.get("amount"),
        "salary_currency": salary.get("currency"),
        "skills": [s if isinstance(s, str) else s.get("name", "") for s in (resume.get("skill_set") or [])],
        "photo_url": photo.get("medium"),
        "resume_url": resume.get("alternate_url"),
        "relevance_score": relevance_score,
        "raw_resume_json": resume,
        "matched_at": datetime.now(timezone.utc),
    }


async def replace_candidates(vacancy: Vacancy, scored_resumes: List[tuple]) -> int:
    """Upsert candidates: update existing by hh_resume_id, insert new ones."""
    from pymongo import UpdateOne

    collection = Candidate.get_motor_collection()
    ops = []
    for resume, score in scored_resumes:
        data = _parse_candidate(vacancy.id, resume, relevance_score=score)
        if not data["hh_resume_id"]:
            continue
        ops.append(
            UpdateOne(
                {"vacancy_id": vacancy.id, "hh_resume_id": data["hh_resume_id"]},
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


async def get_all_candidates(skip: int = 0, limit: int = 20, vacancy_id: Optional[str] = None, search: Optional[str] = None):
    query: dict = {}
    if vacancy_id:
        query["vacancy_id"] = PydanticObjectId(vacancy_id)
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
    total = await Candidate.find(query).count()
    items = await Candidate.find(query).skip(skip).limit(limit).sort("-matched_at").to_list()
    return items, total


async def get_candidate(candidate_id: str) -> Optional[Candidate]:
    return await Candidate.get(PydanticObjectId(candidate_id))
