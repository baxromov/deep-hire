import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
from jose import JWTError, jwt

from app.config import settings
from app.models.user import User

logger = logging.getLogger(__name__)

ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    except Exception:
        return False


def create_access_token(user_id: str, role: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {"sub": user_id, "role": role, "exp": expire}
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)


def decode_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM])
    except JWTError:
        return None


async def get_user_from_token(token: str) -> Optional[User]:
    payload = decode_token(token)
    if not payload:
        return None
    user = await User.get(payload["sub"])
    if not user or not user.is_active:
        return None
    return user


async def authenticate_user(username: str, password: str) -> Optional[User]:
    user = await User.find_one(User.username == username)
    if not user:
        return None
    if not verify_password(password, user.hashed_password):
        return None
    if not user.is_active:
        return None
    return user


async def ensure_admin_exists() -> None:
    """Create default admin user on first startup if no users exist."""
    count = await User.count()
    if count == 0:
        default_admin = User(
            username="admin",
            email="admin@deephire.local",
            hashed_password=hash_password("admin"),
            role="admin",
            full_name="Administrator",
        )
        await default_admin.insert()
        logger.info("Created default admin user (username=admin, password=admin) — CHANGE THIS IMMEDIATELY!")
