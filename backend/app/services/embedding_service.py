import asyncio
import logging
from typing import List

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

_embed_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _embed_client
    if _embed_client is None or _embed_client.is_closed:
        headers = {}
        if settings.litellm_api_key:
            headers["Authorization"] = f"Bearer {settings.litellm_api_key}"
        _embed_client = httpx.AsyncClient(
            headers=headers,
            timeout=httpx.Timeout(connect=10.0, read=60.0, write=10.0, pool=5.0),
            limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
        )
    return _embed_client


async def close_client() -> None:
    global _embed_client
    if _embed_client and not _embed_client.is_closed:
        await _embed_client.aclose()
        _embed_client = None


async def embed(text: str) -> List[float]:
    """Return an embedding vector for a single text using the OpenAI-compatible embed API."""
    if not text or not text.strip():
        return []
    client = _get_client()
    resp = await client.post(
        f"{settings.ollama_base_url}/v1/embeddings",
        json={"model": settings.ollama_embed_model, "input": text},
    )
    resp.raise_for_status()
    return resp.json()["data"][0]["embedding"]


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

    skills = resume.get("skill_set") or []
    if skills:
        parts.append("Skills: " + ", ".join(skills))

    for exp in resume.get("experience") or []:
        if not isinstance(exp, dict):
            continue
        position = exp.get("position") or ""
        description = exp.get("description") or ""
        company_raw = exp.get("company")
        company = (company_raw.get("name") if isinstance(company_raw, dict) else (company_raw or "")) or exp.get("company_name") or ""
        if position:
            parts.append(position)
        if company:
            parts.append(company)
        if description:
            parts.append(description[:500])

    return ". ".join(filter(None, parts))


def build_vacancy_text(vacancy) -> str:
    """Build a plain-text blob from a Vacancy document for embedding."""
    parts = []
    if vacancy.title:
        parts.append(vacancy.title)
    if vacancy.skills:
        parts.append("Required skills: " + ", ".join(vacancy.skills))
    if vacancy.description:
        parts.append(vacancy.description[:1000])
    return ". ".join(filter(None, parts))
