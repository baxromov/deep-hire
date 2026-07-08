import redis.asyncio as aioredis
from beanie import init_beanie
from motor.motor_asyncio import AsyncIOMotorClient
from qdrant_client import AsyncQdrantClient

from app.config import settings
from app.models.candidate import Candidate
from app.models.hh_token import HHToken
from app.models.match_result import MatchResult
from app.models.user import User
from app.models.vacancy import Vacancy

_redis_client: aioredis.Redis | None = None
_qdrant_client: AsyncQdrantClient | None = None


async def init_db() -> None:
    client = AsyncIOMotorClient(settings.mongo_uri)
    await init_beanie(
        database=client[settings.mongo_db],
        document_models=[User, HHToken, Vacancy, Candidate, MatchResult],
    )


async def get_redis() -> aioredis.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = aioredis.from_url(settings.redis_url, decode_responses=True)
    return _redis_client


async def close_redis() -> None:
    global _redis_client
    if _redis_client:
        await _redis_client.aclose()
        _redis_client = None


async def get_qdrant() -> AsyncQdrantClient:
    global _qdrant_client
    if _qdrant_client is None:
        _qdrant_client = AsyncQdrantClient(
            url=settings.qdrant_url,
            api_key=settings.qdrant_api_key or None,
        )
    return _qdrant_client


async def close_qdrant() -> None:
    global _qdrant_client
    if _qdrant_client:
        await _qdrant_client.close()
        _qdrant_client = None
