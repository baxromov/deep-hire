from typing import Dict, List, Optional

import pymongo
from beanie import Document
from pydantic import Field


class Candidate(Document):
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
    is_vectorized: bool = False
    is_saved: bool = True  # False for hh matches not yet confirmed into the candidate database
    raw_resume_json: Dict = Field(default_factory=dict)

    class Settings:
        name = "candidates"
        indexes = [
            pymongo.IndexModel(
                [("hh_resume_id", pymongo.ASCENDING)],
                unique=True,
            )
        ]
