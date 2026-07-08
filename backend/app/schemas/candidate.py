from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel


class CandidateResponse(BaseModel):
    id: str
    vacancy_id: Optional[str] = None
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
    is_vectorized: bool = False
    matched_at: Optional[datetime] = None
    source: Optional[str] = None
    phone: Optional[str] = None
    comment: Optional[str] = None
    score_reasoning: Optional[str] = None
    score_criteria: Optional[List[Any]] = None

    @classmethod
    def from_doc(cls, doc, match_result=None) -> "CandidateResponse":
        raw: dict = doc.raw_resume_json or {}
        resume_url = doc.resume_url
        if not resume_url and (doc.hh_resume_id or "").startswith("cs:"):
            cs_open_url = raw.get("cs_open_url")
            if not cs_open_url:
                docs = raw.get("documents") or []
                if docs:
                    cs_open_url = docs[0].get("open_url")
            if cs_open_url:
                resume_url = f"/api/candidates/{doc.id}/resume"

        mr = match_result
        # Score data: prefer MatchResult, fall back to raw_resume_json (legacy path)
        score_criteria = (mr.score_criteria if mr and mr.score_criteria else None) or raw.get("score_criteria")
        score_reasoning = (mr.score_reasoning if mr else None) or raw.get("score_reasoning")

        return cls(
            id=str(doc.id),
            vacancy_id=str(mr.vacancy_id) if mr else None,
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
            resume_url=resume_url,
            relevance_score=mr.relevance_score if mr else None,
            is_vectorized=doc.is_vectorized,
            matched_at=mr.matched_at if mr else None,
            source=raw.get("source"),
            phone=raw.get("phone"),
            comment=raw.get("comment"),
            score_reasoning=score_reasoning,
            score_criteria=score_criteria,
        )


class CandidateDetailResponse(CandidateResponse):
    raw_resume_json: Dict = {}

    @classmethod
    def from_doc(cls, doc, match_result=None) -> "CandidateDetailResponse":
        base = CandidateResponse.from_doc(doc, match_result)
        return cls(**base.model_dump(), raw_resume_json=doc.raw_resume_json)
