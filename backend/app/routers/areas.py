import logging
from typing import Any, Dict, List

import httpx
from fastapi import APIRouter, Query

from app.config import settings
from app.services.hh_service import _build_headers, get_valid_token

router = APIRouter(prefix="/api/areas", tags=["areas"])
logger = logging.getLogger(__name__)


async def suggest_areas(text: str = Query(..., min_length=1)) -> List[Dict[str, Any]]:
    """Proxy to HH area autocomplete. Returns [{id, text}] list."""
    token = await get_valid_token()
    headers = {**_build_headers()}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{settings.hh_base_url}/suggests/areas",
                params={"text": text, "host": settings.hh_host},
                headers=headers,
            )
            if resp.status_code != 200:
                logger.error("suggest_areas: HH returned %s", resp.status_code)
                return []
            data = resp.json()
            items = data.get("items", [])
            return [{"id": item["id"], "text": item["text"]} for item in items]
    except Exception as exc:
        logger.error("suggest_areas failed: %s", exc)
        return []


async def suggest_skills(text: str = Query(..., min_length=1)) -> List[Dict[str, Any]]:
    """Proxy to HH skill_set autocomplete. Returns [{id, text}] list."""
    token = await get_valid_token()
    headers = {**_build_headers()}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{settings.hh_base_url}/suggests/skill_set",
                params={"text": text, "host": settings.hh_host},
                headers=headers,
            )
            if resp.status_code != 200:
                logger.error("suggest_skills: HH returned %s", resp.status_code)
                return []
            data = resp.json()
            items = data.get("items", [])
            return [{"id": item["id"], "text": item["text"]} for item in items]
    except Exception as exc:
        logger.error("suggest_skills failed: %s", exc)
        return []


_uzbekistan_areas_cache: List[Dict[str, Any]] = []


async def list_uzbekistan_areas() -> List[Dict[str, Any]]:
    """Return all HH.uz areas inside Uzbekistan (area_id=97). Cached after first fetch."""
    global _uzbekistan_areas_cache
    if _uzbekistan_areas_cache:
        return _uzbekistan_areas_cache

    headers = {**_build_headers()}
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{settings.hh_base_url}/areas/{settings.uzbekistan_area_id}",
                params={"host": settings.hh_host},
                headers=headers,
            )
            if resp.status_code != 200:
                logger.error("list_uzbekistan_areas: HH returned %s", resp.status_code)
                return []
            data = resp.json()
            areas = [{"id": a["id"], "name": a["name"]} for a in data.get("areas", [])]
            areas.sort(key=lambda a: a["name"])
            _uzbekistan_areas_cache = areas
            return areas
    except Exception as exc:
        logger.error("list_uzbekistan_areas failed: %s", exc)
        return []


router.add_api_route("/suggest", suggest_areas, methods=["GET"])
router.add_api_route("/suggest-skills", suggest_skills, methods=["GET"])
router.add_api_route("/list", list_uzbekistan_areas, methods=["GET"])
