import hashlib
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from qdrant_client import AsyncQdrantClient
from qdrant_client.http import models as qmodels

from app.config import settings

logger = logging.getLogger(__name__)

VECTOR_SIZE = 1024
DISTANCE = qmodels.Distance.COSINE


async def ensure_collection(client: AsyncQdrantClient) -> None:
    """Create the uzbek_candidates collection if it doesn't exist."""
    existing = {c.name for c in (await client.get_collections()).collections}
    if settings.qdrant_collection not in existing:
        await client.create_collection(
            collection_name=settings.qdrant_collection,
            vectors_config=qmodels.VectorParams(size=VECTOR_SIZE, distance=DISTANCE),
        )
        await client.create_payload_index(
            collection_name=settings.qdrant_collection,
            field_name="area",
            field_schema=qmodels.PayloadSchemaType.KEYWORD,
        )
        await client.create_payload_index(
            collection_name=settings.qdrant_collection,
            field_name="salary_amount",
            field_schema=qmodels.PayloadSchemaType.INTEGER,
        )
        logger.info("Created Qdrant collection '%s' with payload indexes", settings.qdrant_collection)
    else:
        logger.debug("Qdrant collection '%s' already exists", settings.qdrant_collection)


def _resume_payload(resume: Dict[str, Any]) -> Dict[str, Any]:
    """Extract indexable payload fields from a raw HH.uz resume JSON."""
    area = resume.get("area") or {}
    salary = resume.get("salary") or {}

    experience_months = 0
    for exp in resume.get("experience") or []:
        experience_months += exp.get("months", 0) or 0
    experience_years = round(experience_months / 12, 1)

    # Prefer name from top-level fields; fall back to first_name/last_name
    first_name = resume.get("first_name") or ""
    last_name = resume.get("last_name") or ""
    full_name = f"{first_name} {last_name}".strip() or resume.get("title") or ""

    return {
        "hh_resume_id": resume.get("id") or "",
        "full_name": full_name,
        "title": resume.get("title") or "",
        "area": area.get("name") or "",
        "experience_years": experience_years,
        "skills": resume.get("skill_set") or [],
        "salary_amount": salary.get("amount"),
        "salary_currency": salary.get("currency"),
        "employment_type": (resume.get("employment") or {}).get("id") or "",
        "schedule": (resume.get("schedule") or {}).get("id") or "",
        "last_indexed_at": datetime.now(timezone.utc).isoformat(),
        "raw_resume_json": resume,
    }


async def upsert_candidates(
    client: AsyncQdrantClient,
    resumes: List[Dict[str, Any]],
    vectors: List[List[float]],
) -> int:
    """Upsert resume vectors into Qdrant. Returns count of upserted points."""
    points = []
    for resume, vector in zip(resumes, vectors):
        resume_id = resume.get("id") or ""
        if not resume_id or not vector:
            continue
        # Use a stable deterministic integer ID (hash() is not stable across processes)
        point_id = int(hashlib.sha1(resume_id.encode()).hexdigest(), 16) % (2**53)
        points.append(
            qmodels.PointStruct(
                id=point_id,
                vector=vector,
                payload=_resume_payload(resume),
            )
        )

    if not points:
        return 0

    batch_size = 200
    for i in range(0, len(points), batch_size):
        await client.upsert(
            collection_name=settings.qdrant_collection,
            points=points[i:i + batch_size],
        )
    return len(points)


async def search_candidates(
    client: AsyncQdrantClient,
    query_vector: List[float],
    top_k: int = 50,
    area_filter: Optional[str] = None,
    min_salary: Optional[int] = None,
    max_salary: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """Search Qdrant for the top-K most similar candidates.

    Returns a list of payload dicts (including raw_resume_json).
    """
    must_conditions = []

    if area_filter:
        must_conditions.append(
            qmodels.FieldCondition(
                key="area",
                match=qmodels.MatchText(text=area_filter),
            )
        )
    if min_salary is not None:
        must_conditions.append(
            qmodels.FieldCondition(
                key="salary_amount",
                range=qmodels.Range(gte=min_salary),
            )
        )
    if max_salary is not None:
        must_conditions.append(
            qmodels.FieldCondition(
                key="salary_amount",
                range=qmodels.Range(lte=max_salary),
            )
        )

    query_filter = qmodels.Filter(must=must_conditions) if must_conditions else None

    response = await client.query_points(
        collection_name=settings.qdrant_collection,
        query=query_vector,
        limit=top_k,
        query_filter=query_filter,
        score_threshold=0.5,
        with_payload=True,
    )

    results = []
    for hit in response.points:
        if hit.payload:
            payload = dict(hit.payload)
            payload["_qdrant_score"] = hit.score
            results.append(payload)
    return results


async def collection_info(client: AsyncQdrantClient) -> Dict[str, Any]:
    """Return basic stats about the uzbek_candidates collection."""
    try:
        info = await client.get_collection(settings.qdrant_collection)
        return {
            "points_count": info.points_count or 0,
            "indexed_vectors_count": info.indexed_vectors_count or 0,
            "status": info.status.value if info.status else "unknown",
        }
    except Exception:
        return {"points_count": 0, "indexed_vectors_count": 0, "status": "not_found"}


# ── Temporary collection helpers (live pool matching) ─────────────────────────

async def ensure_temp_collection(client: AsyncQdrantClient, collection_name: str) -> None:
    """Create a temporary named collection for one live-pool matching session.

    No payload indexes — temp collections are searched then deleted immediately.
    Silently reuses an existing collection (handles crash-recovery for same name).
    """
    existing = {c.name for c in (await client.get_collections()).collections}
    if collection_name not in existing:
        await client.create_collection(
            collection_name=collection_name,
            vectors_config=qmodels.VectorParams(size=VECTOR_SIZE, distance=DISTANCE),
        )
        logger.info("Created temp Qdrant collection '%s'", collection_name)
    else:
        logger.debug("Temp collection '%s' already exists (prior crash?)", collection_name)


async def upsert_to_temp_collection(
    client: AsyncQdrantClient,
    collection_name: str,
    resumes: List[Dict[str, Any]],
    vectors: List[List[float]],
) -> int:
    """Upsert resume vectors into a named temp collection."""
    points = []
    for resume, vector in zip(resumes, vectors):
        resume_id = resume.get("id") or ""
        if not resume_id or not vector:
            continue
        point_id = int(hashlib.sha1(resume_id.encode()).hexdigest(), 16) % (2**53)
        points.append(
            qmodels.PointStruct(
                id=point_id,
                vector=vector,
                payload=_resume_payload(resume),
            )
        )

    if not points:
        return 0

    batch_size = 200
    for i in range(0, len(points), batch_size):
        await client.upsert(
            collection_name=collection_name,
            points=points[i:i + batch_size],
        )
    return len(points)


async def search_temp_collection(
    client: AsyncQdrantClient,
    collection_name: str,
    query_vector: List[float],
    top_k: int = 50,
    score_threshold: float = 0.85,
) -> List[Dict[str, Any]]:
    """Search a temp collection by vector similarity. No payload filters."""
    response = await client.query_points(
        collection_name=collection_name,
        query=query_vector,
        limit=top_k,
        score_threshold=score_threshold,
        with_payload=True,
    )
    return [hit.payload for hit in response.points if hit.payload]


async def search_temp_collection_scored(
    client: AsyncQdrantClient,
    collection_name: str,
    query_vector: List[float],
    top_k: int = 50,
    score_threshold: float = 0.0,
) -> List[tuple]:
    """Search a temp collection and return (payload, score) pairs sorted by score desc."""
    response = await client.query_points(
        collection_name=collection_name,
        query=query_vector,
        limit=top_k,
        score_threshold=score_threshold,
        with_payload=True,
    )
    return [(hit.payload, hit.score) for hit in response.points if hit.payload]


async def delete_temp_collection(client: AsyncQdrantClient, collection_name: str) -> None:
    """Delete a temporary collection. Safe to call even if it doesn't exist."""
    try:
        await client.delete_collection(collection_name)
        logger.info("Deleted temp Qdrant collection '%s'", collection_name)
    except Exception as exc:
        logger.warning("delete_temp_collection '%s' failed: %s", collection_name, exc)


async def upsert_items_to_temp_collection(
    client: AsyncQdrantClient,
    collection_name: str,
    items: List[Dict[str, Any]],
    vectors: List[List[float]],
) -> int:
    """Upsert generic items into a temp collection.

    Each item must have an 'id' field (string) used to derive the Qdrant point ID.
    All other fields are stored as payload.
    """
    points = []
    for item, vector in zip(items, vectors):
        item_id = str(item.get("id", ""))
        if not item_id or not vector:
            continue
        point_id = int(hashlib.sha1(item_id.encode()).hexdigest(), 16) % (2**53)
        points.append(qmodels.PointStruct(id=point_id, vector=vector, payload=item))

    if not points:
        return 0

    batch_size = 200
    for i in range(0, len(points), batch_size):
        await client.upsert(collection_name=collection_name, points=points[i:i + batch_size])
    return len(points)
