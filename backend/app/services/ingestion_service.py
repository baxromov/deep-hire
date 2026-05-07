import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx

from app.config import settings
from app.services.embedding_service import build_resume_text, embed_batch
from app.services.hh_service import get_valid_token, _build_headers, get_resume_details_bulk, _guarded_get
from app.services.qdrant_service import ensure_collection, upsert_candidates

logger = logging.getLogger(__name__)

_last_ingested_at: Optional[datetime] = None
_ingestion_running: bool = False


def get_ingestion_state() -> Dict[str, Any]:
    return {
        "running": _ingestion_running,
        "last_ingested_at": _last_ingested_at.isoformat() if _last_ingested_at else None,
    }


async def _fetch_resume_page(
    client: httpx.AsyncClient,
    headers: Dict,
    area_id: str,
    page: int,
    per_page: int = 50,
) -> tuple[List[Dict], int]:
    """Fetch one page of resumes for Uzbekistan from HH.uz."""
    params = {
        "area": area_id,
        "per_page": per_page,
        "page": page,
        "host": settings.hh_host,
    }
    try:
        resp = await _guarded_get(
            client,
            f"{settings.hh_base_url}/resumes",
            params=params,
            headers=headers,
        )
        if resp.status_code != 200:
            logger.warning("_fetch_resume_page p%d: HH returned %s", page, resp.status_code)
            return [], 0
        data = resp.json()
        return data.get("items", []), data.get("pages", 1)
    except Exception as exc:
        logger.error("_fetch_resume_page p%d error: %s", page, exc)
        return [], 0


async def run_ingestion(
    qdrant_client,
    pages: int = 40,
    per_page: int = 50,
    area_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Crawl HH.uz resumes for Uzbekistan, embed them, and upsert into Qdrant.

    Returns a summary dict with counts.
    """
    global _last_ingested_at, _ingestion_running

    if _ingestion_running:
        return {"error": "Ingestion already running"}

    _ingestion_running = True
    area = area_id or settings.uzbekistan_area_id
    total_fetched = 0
    total_upserted = 0

    try:
        await ensure_collection(qdrant_client)

        token = await get_valid_token()
        if not token:
            return {"error": "No HH.uz token available"}

        headers = {**_build_headers(), "Authorization": f"Bearer {token}"}

        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            # Discover total pages on page 0
            stub_items, total_pages = await _fetch_resume_page(client, headers, area, 0, per_page)
            pages_to_fetch = min(pages, total_pages)
            logger.info(
                "Ingestion: area=%s total_pages=%d fetching=%d pages",
                area, total_pages, pages_to_fetch,
            )

            # Collect all stub resume IDs from each page (parallel, max 3 concurrent)
            sem = asyncio.Semaphore(3)

            async def fetch_page(p: int) -> List[Dict]:
                async with sem:
                    items, _ = await _fetch_resume_page(client, headers, area, p, per_page)
                    return items

            pages_results = await asyncio.gather(*[fetch_page(p) for p in range(pages_to_fetch)])
            stub_ids = []
            for page_items in pages_results:
                stub_ids.extend(r["id"] for r in page_items if r.get("id"))

            total_fetched = len(stub_ids)
            logger.info("Ingestion: collected %d resume IDs", total_fetched)

        # Fetch full resume details in batches of 50
        batch_size = 50
        for i in range(0, len(stub_ids), batch_size):
            batch_ids = stub_ids[i: i + batch_size]
            full_resumes, rate_limited = await get_resume_details_bulk(batch_ids, concurrency=5)
            if rate_limited:
                logger.warning("Ingestion: hh.uz rate limited %d requests in batch %d", rate_limited, i // batch_size + 1)
            valid = [r for r in full_resumes if r.get("id")]

            # Build text blobs and embed
            texts = [build_resume_text(r) for r in valid]
            vectors = await embed_batch(texts)

            upserted = await upsert_candidates(qdrant_client, valid, vectors)
            total_upserted += upserted
            logger.info(
                "Ingestion batch %d/%d: upserted %d",
                i // batch_size + 1,
                -(-len(stub_ids) // batch_size),
                upserted,
            )

        _last_ingested_at = datetime.now(timezone.utc)
        return {
            "fetched": total_fetched,
            "upserted": total_upserted,
            "area_id": area,
            "pages": pages_to_fetch,
        }

    except Exception as exc:
        logger.error("run_ingestion failed: %s", exc, exc_info=True)
        return {"error": str(exc)}
    finally:
        _ingestion_running = False
