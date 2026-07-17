from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import pymongo
from beanie import Document, PydanticObjectId
from pymongo import IndexModel
from pydantic import Field


class MatchCandidateHit(Document):
    """Unconfirmed HH.ru search hit, staged per vacancy until saved into Candidate."""

    vacancy_id: PydanticObjectId
    hh_resume_id: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    area: Optional[str] = None
    title: Optional[str] = None
    salary_amount: Optional[int] = None
    salary_currency: Optional[str] = None
    skills: List[str] = []
    photo_url: Optional[str] = None
    resume_url: Optional[str] = None
    raw_resume_json: Dict = Field(default_factory=dict)
    relevance_score: Optional[int] = None
    vector_score: Optional[int] = None
    llm_score: Optional[int] = None
    score_reasoning: Optional[str] = None
    score_criteria: List[Dict[str, Any]] = Field(default_factory=list)
    source: str = "hh"
    matched_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    matched_by: Optional[str] = None       # User.id of the staff member who ran this match
    matched_by_name: Optional[str] = None  # denormalized display name, for the dashboard

    class Settings:
        name = "match_candidate_hits"
        indexes = [
            IndexModel(
                [("vacancy_id", pymongo.ASCENDING), ("hh_resume_id", pymongo.ASCENDING)],
                unique=True,
            ),
            IndexModel([("vacancy_id", pymongo.ASCENDING)]),
        ]
