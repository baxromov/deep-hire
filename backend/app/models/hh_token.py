from datetime import datetime
from typing import Optional

from beanie import Document
from pydantic import Field


class HHToken(Document):
    """HH.uz OAuth token — belongs to one user, a user can have many tokens."""
    user_id: str                       # references User.id
    label: str = ""                    # e.g. "Personal", "Work account"
    access_token: str
    refresh_token: str
    expires_at: datetime
    hh_user_id: str = ""
    hh_user_name: str = ""
    email: str = ""
    phone: str = ""
    is_employer: bool = False
    employer_id: str = ""
    employer_name: str = ""
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "hh_tokens"
