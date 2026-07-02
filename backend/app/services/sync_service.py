import hashlib
import logging
import asyncio

from qdrant_client.http import models as qmodels

from app.config import settings
from app.database import get_qdrant, get_redis
from app.services import embedding_service
from app.services import cleverstaff_service as cs

logger = logging.getLogger(__name__)

REDIS_KEY = "cleverstaff:synced_ids"
BATCH_EMBED = 20    # candidates to embed per sub-batch
PAGE_LIMIT = 100    # candidates per MCP page
UPSERT_BATCH = 200  # points per Qdrant upsert call


def _point_id(candidate_id: str) -> int:
    return int(hashlib.sha1(f"cs:{candidate_id}".encode()).hexdigest(), 16) % (2 ** 53)


async def _upsert_batch(qdrant, candidates: list[dict], vectors: list[list[float]]) -> int:
    points = []
    for cand, vec in zip(candidates, vectors):
        if not vec:
            continue
        cid = cand.get("candidate_id", "")
        points.append(qmodels.PointStruct(
            id=_point_id(cid),
            vector=vec,
            payload=cs.build_payload(cand),
        ))
    if not points:
        return 0
    for i in range(0, len(points), UPSERT_BATCH):
        await qdrant.upsert(
            collection_name=settings.qdrant_collection,
            points=points[i:i + UPSERT_BATCH],
        )
    return len(points)


async def sync_cleverstaff() -> dict:
    """Fetch all Cleverstaff candidates, embed new ones, upsert into uzbek_candidates.
    Uses Redis set to skip already-synced candidate_ids (incremental sync).
    """
    if not settings.cleverstaff_mcp_token:
        logger.warning("cleverstaff_mcp_token not set — skipping sync")
        return {"skipped": True}

    logger.info("Cleverstaff sync started → collection: %s", settings.qdrant_collection)
    qdrant = await get_qdrant()
    redis = await get_redis()

    offset = 0
    total_fetched = 0
    total_new = 0
    global_total = None

    while True:
        try:
            result = await cs.fetch_candidates(offset=offset, limit=PAGE_LIMIT)
        except Exception as exc:
            logger.error("Cleverstaff MCP error at offset=%d: %s", offset, exc)
            break

        page = result.get("candidates", [])
        if not page:
            break

        if global_total is None:
            global_total = result.get("total", 0)

        total_fetched += len(page)

        # Batch-check Redis: which candidate_ids are already synced?
        cids = [c.get("candidate_id", "") for c in page]
        is_known = await redis.smismember(REDIS_KEY, *cids)
        new_candidates = [c for c, known in zip(page, is_known) if not known]

        if new_candidates:
            for i in range(0, len(new_candidates), BATCH_EMBED):
                batch = new_candidates[i:i + BATCH_EMBED]
                texts = [cs.build_embedding_text(c) for c in batch]
                vectors = await embedding_service.embed_batch(texts)
                upserted = await _upsert_batch(qdrant, batch, vectors)
                total_new += upserted

                new_ids = [c["candidate_id"] for c in batch if c.get("candidate_id")]
                if new_ids:
                    await redis.sadd(REDIS_KEY, *new_ids)

        logger.info(
            "Cleverstaff sync: offset=%d/%s fetched=%d new=%d",
            offset, global_total, total_fetched, total_new,
        )

        offset += PAGE_LIMIT
        if global_total and offset >= global_total:
            break

        await asyncio.sleep(0.1)

    logger.info("Cleverstaff sync done: fetched=%d new=%d", total_fetched, total_new)
    return {"fetched": total_fetched, "new": total_new}
