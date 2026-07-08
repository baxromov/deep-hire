from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import pymongo
from beanie import Document, PydanticObjectId
from pymongo import IndexModel
from pydantic import Field


class MatchResult(Document):
    vacancy_id: PydanticObjectId
    candidate_id: PydanticObjectId
    hh_resume_id: str
    relevance_score: Optional[int] = None
    score_reasoning: Optional[str] = None
    score_criteria: List[Dict[str, Any]] = Field(default_factory=list)
    source: str = "db_search"
    matched_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    class Settings:
        name = "match_results"
        indexes = [
            IndexModel(
                [("vacancy_id", pymongo.ASCENDING), ("hh_resume_id", pymongo.ASCENDING)],
                unique=True,
            ),
            IndexModel([("vacancy_id", pymongo.ASCENDING)]),
            IndexModel([("candidate_id", pymongo.ASCENDING)]),
        ]
