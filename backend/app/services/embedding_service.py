import asyncio
import logging
from typing import Any, Dict, List

from openai import AsyncOpenAI

from app.config import settings

logger = logging.getLogger(__name__)

_embed_client: AsyncOpenAI | None = None

# ── HuggingFace CrossEncoder reranker (lazy-loaded on first use) ──────────────
_reranker = None   # sentence_transformers.CrossEncoder instance
_reranker_model_name: str = ""


def _get_reranker():
    """Lazy-load the HuggingFace CrossEncoder model. Downloaded once, cached in memory."""
    global _reranker, _reranker_model_name
    model_name = settings.reranker_model
    if _reranker is None or _reranker_model_name != model_name:
        from sentence_transformers import CrossEncoder
        logger.info("Loading reranker model '%s' from HuggingFace…", model_name)
        _reranker = CrossEncoder(
            model_name,
            max_length=512,
            # device is auto-detected: CUDA if available, else CPU
        )
        _reranker_model_name = model_name
        logger.info("Reranker model '%s' loaded.", model_name)
    return _reranker


def _predict_scores(model, pairs: list) -> list:
    """Synchronous predict — runs in a thread pool executor."""
    import numpy as np
    raw = model.predict(pairs, batch_size=32, show_progress_bar=False)
    # sigmoid-normalize if scores are logits (raw values outside [0,1])
    arr = np.array(raw, dtype=float)
    if arr.max() > 1.0 or arr.min() < 0.0:
        arr = 1.0 / (1.0 + np.exp(-arr))
    return arr.tolist()


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


async def rerank(
    query: str,
    documents: List[str],
    top_n: int | None = None,
) -> List[Dict[str, Any]]:
    """Cross-encoder reranking using a HuggingFace model (sentence-transformers).

    Model is loaded once from HF Hub on first call and cached in memory.
    Inference runs in a thread-pool executor so the async event loop stays free.

    Default model: BAAI/bge-reranker-v2-m3  (multilingual, works well for
    Russian/Uzbek resumes on CPU — ~2-5 s for 30 docs on a modern CPU).

    .env to enable:
        USE_RERANKER=true
        RERANKER_MODEL=BAAI/bge-reranker-v2-m3

    Returns list of {"index": int, "relevance_score": float} sorted by score desc.
    Falls back to identity order on any error (non-fatal).
    """
    if not documents:
        return []

    try:
        model = _get_reranker()
        pairs = [[query, doc] for doc in documents]

        loop = asyncio.get_event_loop()
        scores: list = await loop.run_in_executor(None, _predict_scores, model, pairs)

        results = sorted(
            [{"index": i, "relevance_score": float(s)} for i, s in enumerate(scores)],
            key=lambda r: r["relevance_score"],
            reverse=True,
        )
        if top_n is not None:
            results = results[:top_n]

        logger.info(
            "rerank: %d docs → top score=%.3f (model=%s)",
            len(documents), results[0]["relevance_score"] if results else 0, settings.reranker_model,
        )
        return results

    except Exception as exc:
        logger.warning("rerank: failed (%s) — falling back to original order", exc)
        return [{"index": i, "relevance_score": 0.5} for i in range(len(documents))]


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
    """Build a semantically rich plain-text blob from a raw HH.uz resume JSON for embedding.

    Strategy: triple-weight title (most discriminative signal), double-weight skills,
    then add experience positions/descriptions, education, languages, and about text.
    More context → better cosine similarity with vacancy embeddings.
    """
    parts = []

    # Title: tripled — strongest signal for role matching
    title = resume.get("title") or ""
    if title:
        parts.extend([title, title, title])

    # Skills: doubled — second strongest signal
    skills = resume.get("skill_set") or []
    if skills:
        skills_str = "Skills: " + ", ".join(skills[:30])
        parts.extend([skills_str, skills_str])

    # About / summary text
    about = resume.get("skills") or resume.get("about") or ""
    if about:
        parts.append(about[:600])

    # Work experience: position name + description (up to 3 most recent roles)
    # Guard against int (e.g. Cleverstaff stores experience as years)
    _exp_raw = resume.get("experience")
    for exp in (_exp_raw if isinstance(_exp_raw, list) else [])[:3]:
        if not isinstance(exp, dict):
            continue
        position = exp.get("position") or ""
        description = exp.get("description") or ""
        company_raw = exp.get("company")
        company = (company_raw.get("name") if isinstance(company_raw, dict) else (company_raw or "")) or exp.get("company_name") or ""
        if position:
            parts.append(f"{position}{' at ' + company if company else ''}")
        if description:
            parts.append(description[:500])

    # Education — degree / specialty names
    for edu in (resume.get("education") or {}).get("additional", []) or []:
        if isinstance(edu, dict):
            name = edu.get("name") or edu.get("organization") or ""
            if name:
                parts.append(name)
    primary_edu = (resume.get("education") or {})
    for level_key in ("level", "primary"):
        for entry in (primary_edu.get(level_key) or []):
            if isinstance(entry, dict):
                spec = entry.get("name") or entry.get("specialization") or ""
                if spec:
                    parts.append(spec)

    # Languages
    for lang in (resume.get("language") or [])[:4]:
        if isinstance(lang, dict):
            name = (lang.get("id") or "").replace("_", " ")
            level = (lang.get("level") or {}).get("id") or ""
            if name:
                parts.append(f"{name} {level}".strip())

    return ". ".join(filter(None, parts))


def build_vacancy_text(vacancy) -> str:
    """Build a semantically rich plain-text blob from a Vacancy document for embedding.

    Strategy: triple-weight title, double-weight required skills, then include
    description, experience requirement, and employment details for richer context.
    """
    parts = []

    # Title: tripled — primary matching signal
    if vacancy.title:
        parts.extend([vacancy.title, vacancy.title, vacancy.title])

    # Required skills: doubled
    if vacancy.skills:
        skills_str = "Required skills: " + ", ".join(vacancy.skills)
        parts.extend([skills_str, skills_str])

    # Experience requirement — expressed as natural text for better semantic match
    exp_map = {
        "noExperience": "No experience required",
        "between1And3": "1-3 years of experience required",
        "between3And6": "3-6 years of experience required",
        "moreThan6": "More than 6 years of experience required",
    }
    if getattr(vacancy, "experience", None):
        exp_text = exp_map.get(vacancy.experience, vacancy.experience)
        parts.append(exp_text)

    # Full description (increased from 800 → 1500 chars)
    if vacancy.description:
        parts.append(vacancy.description[:1500])

    return ". ".join(filter(None, parts))
