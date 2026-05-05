import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.database import get_qdrant
from app.services.ingestion_service import get_ingestion_state, run_ingestion
from app.services.qdrant_service import collection_info

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/talent-pool", tags=["talent-pool"])


class IngestRequest(BaseModel):
    pages: int = 10
    per_page: int = 50
    area_id: Optional[str] = None


class IngestResponse(BaseModel):
    fetched: int = 0
    upserted: int = 0
    area_id: str = ""
    pages: int = 0
    error: Optional[str] = None


@router.get("/status")
async def talent_pool_status():
    """Return Qdrant collection stats and ingestion state."""
    client = await get_qdrant()
    info = await collection_info(client)
    state = get_ingestion_state()
    return {**info, **state}


@router.post("/ingest", response_model=IngestResponse)
async def ingest(body: IngestRequest):
    """
    Trigger ingestion: crawl HH.uz resumes for Uzbekistan, embed, upsert to Qdrant.
    Runs synchronously (blocks until done). Use small pages value for quick tests.
    """
    client = await get_qdrant()
    result = await run_ingestion(
        qdrant_client=client,
        pages=body.pages,
        per_page=body.per_page,
        area_id=body.area_id,
    )
    if "error" in result and result["error"]:
        if result["error"] == "Ingestion already running":
            raise HTTPException(status_code=409, detail="Ingestion already in progress")
        raise HTTPException(status_code=500, detail=result["error"])
    return IngestResponse(**result)


@router.post("/ingest/background")
async def ingest_background(body: IngestRequest):
    """Trigger ingestion in the background and return immediately."""
    client = await get_qdrant()
    state = get_ingestion_state()
    if state["running"]:
        raise HTTPException(status_code=409, detail="Ingestion already in progress")

    asyncio.create_task(
        run_ingestion(
            qdrant_client=client,
            pages=body.pages,
            per_page=body.per_page,
            area_id=body.area_id,
        )
    )
    return {"message": "Ingestion started in background"}
