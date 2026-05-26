from datetime import datetime
from typing import Optional
from beanie import Document
from pydantic import Field


class User(Document):
    username: str
    email: str = ""
    hashed_password: str
    role: str = "staff"          # "admin" | "staff"
    full_name: str = ""
    is_active: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "users"
