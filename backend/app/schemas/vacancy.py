from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel

from app.models.vacancy import VacancyStatus


class VacancyUpdate(BaseModel):
    title: Optional[str] = None
    skills: Optional[List[str]] = None
    area: Optional[str] = None
    area_hh_id: Optional[str] = None
    salary_from: Optional[int] = None
    salary_to: Optional[int] = None
    currency: Optional[str] = None
    experience: Optional[str] = None
    employment_type: Optional[str] = None
    schedule: Optional[str] = None
    description: Optional[str] = None
    raw_description: Optional[str] = None
    score_criteria: Optional[List[dict]] = None


class VacancyResponse(BaseModel):
    id: str
    title: Optional[str]
    skills: List[str]
    area: Optional[str]
    area_hh_id: Optional[str]
    salary_from: Optional[int]
    salary_to: Optional[int]
    currency: str
    experience: Optional[str]
    employment_type: Optional[str]
    schedule: Optional[str]
    description: Optional[str]
    status: VacancyStatus
    is_open: bool
    is_approvable: bool
    last_matched_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime
    score_criteria: List[dict]

    @classmethod
    def from_doc(cls, doc) -> "VacancyResponse":
        _default_criteria = [
            {"name": "Соответствие должности", "weight": 45},
            {"name": "Навыки и инструменты",   "weight": 40},
            {"name": "Уровень опыта",          "weight": 15},
        ]
        return cls(
            id=str(doc.id),
            title=doc.title,
            skills=doc.skills,
            area=doc.area,
            area_hh_id=doc.area_hh_id,
            salary_from=doc.salary_from,
            salary_to=doc.salary_to,
            currency=doc.currency,
            experience=doc.experience,
            employment_type=doc.employment_type,
            schedule=doc.schedule,
            description=doc.description,
            status=doc.status,
            is_open=doc.is_open,
            is_approvable=doc.is_approvable(),
            last_matched_at=doc.last_matched_at,
            created_at=doc.created_at,
            updated_at=doc.updated_at,
            score_criteria=doc.score_criteria if isinstance(doc.score_criteria, list) and doc.score_criteria
                           else _default_criteria,
        )


class AIExtractedFields(BaseModel):
    title: Optional[str] = None
    skills: Optional[List[str]] = None
    area: Optional[str] = None
    salary_from: Optional[int] = None
    salary_to: Optional[int] = None
    currency: Optional[str] = None
    experience: Optional[str] = None
    employment_type: Optional[str] = None
    schedule: Optional[str] = None
    description: Optional[str] = None
