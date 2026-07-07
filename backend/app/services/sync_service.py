import hashlib
import logging
import asyncio
from datetime import datetime, timezone

from pymongo import UpdateOne
from qdrant_client.http import models as qmodels

from app.config import settings
from app.database import get_qdrant, get_redis
from app.models.candidate import Candidate
from app.services import embedding_service
from app.services import cleverstaff_service as cs
from app.services.qdrant_service import ensure_collection

logger = logging.getLogger(__name__)

REDIS_KEY = "cleverstaff:synced_ids"
BATCH_EMBED = 20    # candidates to embed per sub-batch
PAGE_LIMIT = 100    # candidates per MCP page
UPSERT_BATCH = 200  # points per Qdrant upsert call


def _point_id(candidate_id: str) -> int:
    return int(hashlib.sha1(f"cs:{candidate_id}".encode()).hexdigest(), 16) % (2 ** 53)


async def _upsert_batch(qdrant, candidates: list[dict], vectors: list[list[float]]) -> int:
    points = []
    mongo_ops = []
    now = datetime.now(timezone.utc)

    for cand, vec in zip(candidates, vectors):
        if not vec:
            continue
        cid = cand.get("candidate_id", "")
        hh_resume_id = f"cs:{cid}"

        payload = cs.build_payload(cand)
        points.append(qmodels.PointStruct(
            id=_point_id(cid),
            vector=vec,
            payload=payload,
        ))

        full_name = cand.get("full_name") or ""
        name_parts = full_name.split(" ", 1)
        skills = [s["skill"] for s in cand.get("skills", []) if s.get("skill")]
        salary = cand.get("salary")
        raw_json = payload["raw_resume_json"]

        # Filter targets only pool records (vacancy_id=None).
        # $setOnInsert keeps vacancy_id=None on new inserts; on update the $set
        # does not include vacancy_id so a previously-matched record is never
        # overwritten with None.
        mongo_ops.append(UpdateOne(
            {"vacancy_id": None, "hh_resume_id": hh_resume_id},
            {
                "$set": {
                    "hh_resume_id": hh_resume_id,
                    "first_name": name_parts[0] if name_parts else "",
                    "last_name": name_parts[1] if len(name_parts) > 1 else "",
                    "title": cand.get("position") or "",
                    "area": cand.get("region") or "",
                    "skills": skills,
                    "salary_amount": int(salary) if salary is not None else None,
                    "salary_currency": cand.get("currency"),
                    "raw_resume_json": raw_json,
                    "is_vectorized": True,
                    "matched_at": now,
                },
                "$setOnInsert": {"vacancy_id": None},
            },
            upsert=True,
        ))

    if not points:
        logger.debug("_upsert_batch: no valid vectors — skipping")
        return 0

    for i in range(0, len(points), UPSERT_BATCH):
        batch_slice = points[i:i + UPSERT_BATCH]
        await qdrant.upsert(collection_name=settings.qdrant_collection, points=batch_slice)
        logger.debug("Qdrant upsert: %d points (slice %d–%d)", len(batch_slice), i, i + len(batch_slice))

    if mongo_ops:
        col = Candidate.get_motor_collection()
        result = await col.bulk_write(mongo_ops, ordered=False)
        logger.debug("MongoDB bulk_write: upserted=%d modified=%d",
                     result.upserted_count, result.modified_count)

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
    await ensure_collection(qdrant)
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
        skipped = len(page) - len(new_candidates)

        logger.info(
            "Page offset=%d: fetched=%d new=%d already_synced=%d",
            offset, len(page), len(new_candidates), skipped,
        )

        if new_candidates:
            for i in range(0, len(new_candidates), BATCH_EMBED):
                batch = new_candidates[i:i + BATCH_EMBED]
                logger.info("Embedding batch %d–%d (%d candidates)…",
                            i, i + len(batch), len(batch))
                texts = [cs.build_embedding_text(c) for c in batch]
                vectors = await embedding_service.embed_batch(texts)
                valid_vecs = sum(1 for v in vectors if v)
                logger.info("Embedding done: %d/%d vectors obtained", valid_vecs, len(batch))
                upserted = await _upsert_batch(qdrant, batch, vectors)
                total_new += upserted
                logger.info("Upserted %d candidates (Qdrant + MongoDB)", upserted)

                new_ids = [c["candidate_id"] for c in batch if c.get("candidate_id")]
                if new_ids:
                    await redis.sadd(REDIS_KEY, *new_ids)
                    logger.debug("Redis: marked %d ids as synced", len(new_ids))

        logger.info(
            "Cleverstaff sync progress: offset=%d/%s total_fetched=%d total_new=%d",
            offset, global_total, total_fetched, total_new,
        )

        offset += PAGE_LIMIT
        if global_total and offset >= global_total:
            break

        await asyncio.sleep(0.1)

    logger.info("Cleverstaff sync done: fetched=%d new=%d", total_fetched, total_new)
    return {"fetched": total_fetched, "new": total_new}
