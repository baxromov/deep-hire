from datetime import datetime
from typing import Dict, List, Optional

import pymongo
from beanie import Document, PydanticObjectId
from pydantic import Field


class Candidate(Document):
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
    relevance_score: Optional[int] = None
    raw_resume_json: Dict = Field(default_factory=dict)
    matched_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "candidates"
        indexes = [
            pymongo.IndexModel(
                [("vacancy_id", pymongo.ASCENDING), ("hh_resume_id", pymongo.ASCENDING)],
                unique=True,
            )
        ]
