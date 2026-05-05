from datetime import datetime
from enum import Enum
from typing import List, Optional

from beanie import Document
from pydantic import Field


class VacancyStatus(str, Enum):
    draft = "draft"
    approved = "approved"
    closed = "closed"
    archived = "archived"


class Vacancy(Document):
    title: Optional[str] = None
    skills: List[str] = []
    area: Optional[str] = None
    area_hh_id: Optional[str] = None
    salary_from: Optional[int] = None
    salary_to: Optional[int] = None
    currency: str = "UZS"
    experience: Optional[str] = None      # noExperience | between1And3 | between3And6 | moreThan6
    employment_type: Optional[str] = None # full | part | project | volunteer | probation
    schedule: Optional[str] = None        # fullDay | shift | flexible | remote | flyInFlyOut
    description: Optional[str] = None
    raw_description: Optional[str] = None
    status: VacancyStatus = VacancyStatus.draft
    is_open: bool = True
    last_matched_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    def is_approvable(self) -> bool:
        required = [self.title, self.description, self.experience]
        return all(f is not None and f != "" for f in required)

    class Settings:
        name = "vacancies"
