from datetime import datetime
from typing import Dict, List, Optional

from pydantic import BaseModel


class CandidateResponse(BaseModel):
    id: str
    vacancy_id: str
    hh_resume_id: str
    first_name: Optional[str]
    last_name: Optional[str]
    age: Optional[int]
    gender: Optional[str]
    area: Optional[str]
    title: Optional[str]
    salary_amount: Optional[int]
    salary_currency: Optional[str]
    skills: List[str]
    photo_url: Optional[str]
    resume_url: Optional[str]
    relevance_score: Optional[int]
    matched_at: datetime

    @classmethod
    def from_doc(cls, doc) -> "CandidateResponse":
        return cls(
            id=str(doc.id),
            vacancy_id=str(doc.vacancy_id),
            hh_resume_id=doc.hh_resume_id,
            first_name=doc.first_name,
            last_name=doc.last_name,
            age=doc.age,
            gender=doc.gender,
            area=doc.area,
            title=doc.title,
            salary_amount=doc.salary_amount,
            salary_currency=doc.salary_currency,
            skills=doc.skills,
            photo_url=doc.photo_url,
            resume_url=doc.resume_url,
            relevance_score=doc.relevance_score,
            matched_at=doc.matched_at,
        )


class CandidateDetailResponse(CandidateResponse):
    raw_resume_json: Dict = {}

    @classmethod
    def from_doc(cls, doc) -> "CandidateDetailResponse":
        base = CandidateResponse.from_doc(doc)
        return cls(**base.model_dump(), raw_resume_json=doc.raw_resume_json)
