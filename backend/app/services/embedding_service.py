import asyncio
import logging
from typing import List

from openai import AsyncOpenAI

from app.config import settings

logger = logging.getLogger(__name__)

_embed_client: AsyncOpenAI | None = None


def _get_client() -> AsyncOpenAI:
    global _embed_client
    if _embed_client is None:
        embed_base_url = settings.ollama_embed_base_url or settings.ollama_base_url
        _embed_client = AsyncOpenAI(
            base_url=f"{embed_base_url}/v1",
            api_key=settings.litellm_api_key or "no-key",
        )
    return _embed_client


async def close_client() -> None:
    global _embed_client
    if _embed_client is not None:
        await _embed_client.close()
        _embed_client = None


async def embed(text: str) -> List[float]:
    """Return an embedding vector for a single text using the OpenAI-compatible embed API."""
    if not text or not text.strip():
        return []
    client = _get_client()
    response = await client.embeddings.create(
        model=settings.ollama_embed_model,
        input=text,
    )
    return response.data[0].embedding


async def embed_batch(texts: List[str], concurrency: int = 5) -> List[List[float]]:
    """Embed multiple texts concurrently (bounded by semaphore)."""
    sem = asyncio.Semaphore(concurrency)

    async def _one(text: str) -> List[float]:
        async with sem:
            try:
                return await embed(text)
            except Exception as exc:
                logger.error("embed_batch: failed for text snippet: %s", exc)
                return []

    return list(await asyncio.gather(*[_one(t) for t in texts]))


def build_resume_text(resume: dict) -> str:
    """Build a plain-text blob from a raw HH.uz resume JSON for embedding."""
    parts = []

    title = resume.get("title") or ""
    if title:
        parts.append(title)
        parts.append(title)

    skills = resume.get("skill_set") or []
    if skills:
        skills_str = "Skills: " + ", ".join(skills[:25])
        parts.append(skills_str)
        parts.append(skills_str)

    for exp in resume.get("experience") or []:
        if not isinstance(exp, dict):
            continue
        position = exp.get("position") or ""
        description = exp.get("description") or ""
        company_raw = exp.get("company")
        company = (company_raw.get("name") if isinstance(company_raw, dict) else (company_raw or "")) or exp.get("company_name") or ""
        if position:
            parts.append(position)
        if description:
            parts.append(description[:400])

    return ". ".join(filter(None, parts))


def build_vacancy_text(vacancy) -> str:
    """Build a plain-text blob from a Vacancy document for embedding."""
    parts = []
    if vacancy.title:
        parts.append(vacancy.title)
        parts.append(vacancy.title)
    if vacancy.skills:
        skills_str = "Required skills: " + ", ".join(vacancy.skills)
        parts.append(skills_str)
        parts.append(skills_str)
    if vacancy.description:
        parts.append(vacancy.description[:800])
    return ". ".join(filter(None, parts))
