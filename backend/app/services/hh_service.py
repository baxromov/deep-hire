import asyncio
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import urlencode

import httpx

from app.config import settings
from app.database import get_redis
from app.models.hh_token import HHToken
from app.models.vacancy import Vacancy

logger = logging.getLogger(__name__)

REDIS_TOKEN_KEY = "hh:access_token"

_RATE_LIMITED = object()  # sentinel for 429 responses from hh.uz


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _build_headers() -> Dict[str, str]:
    return {"HH-User-Agent": settings.app_user_agent}


async def get_auth_url(state: str = "") -> str:
    params = {
        "response_type": "code",
        "client_id": settings.hh_client_id,
        "redirect_uri": settings.hh_redirect_uri,
        "skip_choose_account": "true",
        "role": "employer",
    }
    if state:
        params["state"] = state
    return f"{settings.hh_oauth_url}?{urlencode(params)}"


async def exchange_code(code: str) -> HHToken:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            settings.hh_token_url,
            data={
                "grant_type": "authorization_code",
                "client_id": settings.hh_client_id,
                "client_secret": settings.hh_client_secret,
                "redirect_uri": settings.hh_redirect_uri,
                "code": code,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        resp.raise_for_status()
        data = resp.json()

    expires_at = _utcnow() + timedelta(seconds=data["expires_in"])

    # Fetch user info (best-effort — don't fail login if /me is unreachable)
    try:
        user_info = await _fetch_me(data["access_token"])
    except Exception:
        user_info = {}

    # Remove any existing token
    await HHToken.find_all().delete()

    employer = user_info.get("employer") or {}
    token = HHToken(
        access_token=data["access_token"],
        refresh_token=data["refresh_token"],
        expires_at=expires_at,
        hh_user_id=str(user_info.get("id") or ""),
        hh_user_name=f"{user_info.get('first_name') or ''} {user_info.get('last_name') or ''}".strip(),
        email=user_info.get("email") or "",
        phone=user_info.get("phone") or "",
        is_employer=bool(user_info.get("is_employer")),
        employer_id=str(employer.get("id") or ""),
        employer_name=employer.get("name") or "",
    )
    await token.insert()

    redis = await get_redis()
    ttl = max(1, int((expires_at - _utcnow()).total_seconds()) - 300)
    await redis.set(REDIS_TOKEN_KEY, data["access_token"], ex=ttl)

    return token


async def _refresh_token(token: HHToken) -> HHToken:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            settings.hh_token_url,
            data={
                "grant_type": "refresh_token",
                "refresh_token": token.refresh_token,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        resp.raise_for_status()
        data = resp.json()

    expires_at = _utcnow() + timedelta(seconds=data["expires_in"])
    token.access_token = data["access_token"]
    token.refresh_token = data["refresh_token"]
    token.expires_at = expires_at
    token.updated_at = _utcnow()
    await token.save()

    redis = await get_redis()
    ttl = max(1, int((expires_at - _utcnow()).total_seconds()) - 300)
    await redis.set(REDIS_TOKEN_KEY, data["access_token"], ex=ttl)

    return token


async def get_valid_token() -> Optional[str]:
    redis = await get_redis()
    cached = await redis.get(REDIS_TOKEN_KEY)
    if cached:
        return cached

    token = await HHToken.find_one()
    if not token:
        return None

    expires_at = token.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    if expires_at - _utcnow() < timedelta(minutes=5):
        token = await _refresh_token(token)

    return token.access_token


async def _fetch_me(access_token: str) -> Dict:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{settings.hh_base_url}/me",
            params={"host": settings.hh_host},
            headers={**_build_headers(), "Authorization": f"Bearer {access_token}"},
        )
        if resp.status_code == 200:
            return resp.json()
        return {}


async def get_me() -> Dict:
    token_doc = await HHToken.find_one()
    if not token_doc:
        return {}
    return {
        "id": token_doc.hh_user_id,
        "name": token_doc.hh_user_name,
        "email": token_doc.email,
        "phone": token_doc.phone,
        "is_employer": token_doc.is_employer,
        "employer_id": token_doc.employer_id,
        "employer_name": token_doc.employer_name,
    }


async def invalidate_token() -> None:
    token_str = await get_valid_token()
    if token_str:
        async with httpx.AsyncClient() as client:
            await client.delete(
                f"{settings.hh_base_url}/token",
                headers={**_build_headers(), "Authorization": f"Bearer {token_str}"},
            )
    await HHToken.find_all().delete()
    redis = await get_redis()
    await redis.delete(REDIS_TOKEN_KEY)


# Russian/common stop-words to strip when shortening a title
_STOP_WORDS = {
    "и", "в", "по", "на", "с", "для", "из", "от", "к", "о", "об", "при",
    "за", "до", "без", "над", "под", "между", "через", "или", "не", "но",
    "а", "то", "же", "бы", "ли", "уж", "по", "со", "ко",
}


def _title_variants(title: str) -> List[str]:
    """Return progressively shorter/broader search queries for a vacancy title.

    Strategy:
      1. Full title, search in 'title' field, logic=all
      2. First 3 meaningful words, search in 'title' field, logic=all
      3. First 2 meaningful words, search in 'title' field, logic=any
      4. First meaningful word only, search everywhere (no field), logic=any
    """
    words = title.strip().split()
    meaningful = [w for w in words if w.lower() not in _STOP_WORDS and len(w) > 1]

    variants = []
    # 1. Full title
    variants.append((title, "all", "title"))
    # 2. First 3 meaningful words (only if different from full title)
    if len(meaningful) > 3:
        variants.append((" ".join(meaningful[:3]), "all", "title"))
    # 3. First 2 meaningful words, any logic
    if len(meaningful) > 1:
        variants.append((" ".join(meaningful[:2]), "any", "title"))
    # 4. Single most meaningful word, search everywhere
    if meaningful:
        variants.append((meaningful[0], "any", ""))

    # Deduplicate while preserving order
    seen: set = set()
    result = []
    for v in variants:
        if v[0] not in seen:
            seen.add(v[0])
            result.append(v)
    return result


def get_title_variants(title: str) -> List[tuple[str, str, str]]:
    """Public wrapper around _title_variants for use by other modules."""
    return _title_variants(title)


def title_score(candidate_title: str, vacancy_title: str) -> float:
    """Keyword overlap ratio between candidate and vacancy titles (0.0 – 1.0)."""
    vac_words = set(w for w in re.split(r"\W+", vacancy_title.lower()) if len(w) > 1)
    can_words = set(w for w in re.split(r"\W+", candidate_title.lower()) if len(w) > 1)
    if not vac_words:
        return 0.0
    return len(vac_words & can_words) / len(vac_words)


def _is_cyrillic(text: str) -> bool:
    return any("\u0400" <= ch <= "\u04ff" for ch in text)


def build_search_variants(queries: List[str]) -> List[tuple[str, str, str]]:
    """Convert AI-generated job-title phrases into (text, logic, field) search tuples.

    Interleaves Russian and English queries so we alternate languages instead of
    exhausting all Russian before trying English. All queries search the 'title'
    field. First query is strict (logic=all), the rest are permissive (logic=any).
    """
    ru = [q.strip() for q in queries if q.strip() and _is_cyrillic(q)]
    en = [q.strip() for q in queries if q.strip() and not _is_cyrillic(q)]

    # Interleave: ru[0], en[0], ru[1], en[1], ...
    interleaved: List[str] = []
    for pair in zip(ru, en):
        interleaved.extend(pair)
    # Append leftovers if one list is longer
    interleaved.extend(ru[len(en):])
    interleaved.extend(en[len(ru):])

    seen: set[str] = set()
    variants: List[tuple[str, str, str]] = []
    for i, q in enumerate(interleaved):
        if q in seen:
            continue
        seen.add(q)
        logic = "all" if i == 0 else "any"
        variants.append((q, logic, "title"))
    return variants


def _build_base_params(vacancy: Vacancy, per_page: int) -> Dict[str, Any]:
    params: Dict[str, Any] = {"per_page": per_page, "host": settings.hh_host}
    params["area"] = vacancy.area_hh_id or settings.uzbekistan_area_id
    if vacancy.experience:
        params["experience"] = vacancy.experience
    if vacancy.employment_type:
        params["employment"] = vacancy.employment_type
    if vacancy.schedule:
        params["schedule"] = vacancy.schedule
    if vacancy.salary_from:
        params["salary_from"] = vacancy.salary_from
    if vacancy.salary_to:
        params["salary_to"] = vacancy.salary_to
    return params


async def _do_search(
    client: httpx.AsyncClient,
    headers: Dict,
    text: str,
    logic: str,
    field: str,
    base_params: Dict[str, Any],
    page: int = 0,
) -> tuple[List[Dict], int]:
    """Returns (items, total_pages)."""
    params = {**base_params, "text": text, "text.logic": logic, "text.period": "", "page": page}
    if field:
        params["text.field"] = field
    resp = await client.get(f"{settings.hh_base_url}/resumes", params=params, headers=headers)
    if resp.status_code != 200:
        logger.error("_do_search: HH returned %s — %s", resp.status_code, resp.text[:200])
        return [], 0
    data = resp.json()
    return data.get("items", []), data.get("pages", 1)


async def find_search_variant(
    vacancy: Vacancy, per_page: int = 50
) -> Optional[tuple[str, str, str, List[Dict], int]]:
    """Try title variants until one returns results.

    Returns (text, logic, field, page0_items, total_pages) or None if all variants fail.
    The first page of results is returned together with the variant so callers avoid
    making a duplicate request for page 0.
    """
    token = await get_valid_token()
    if not token or not vacancy.title:
        return None

    base_params = _build_base_params(vacancy, per_page)
    headers = {**_build_headers(), "Authorization": f"Bearer {token}"}

    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            for text, logic, field in _title_variants(vacancy.title):
                logger.info(
                    "find_search_variant: trying text=%r logic=%s field=%s",
                    text, logic, field or "all_fields",
                )
                items, total_pages = await _do_search(client, headers, text, logic, field, base_params, page=0)
                if items:
                    logger.info(
                        "find_search_variant: %d results, total_pages=%d for text=%r",
                        len(items), total_pages, text,
                    )
                    return text, logic, field, items, total_pages
                logger.info("find_search_variant: 0 results, trying next variant")
    except Exception as exc:
        logger.error("find_search_variant failed: %s", exc)

    logger.warning("find_search_variant: all variants exhausted")
    return None


async def search_resumes_page(
    vacancy: Vacancy,
    page: int,
    text: str,
    logic: str,
    field: str,
    per_page: int = 50,
) -> tuple[List[Dict], int]:
    """Fetch a specific page of results for a known search variant.

    Returns (items, total_pages).
    """
    token = await get_valid_token()
    if not token:
        return [], 0

    base_params = _build_base_params(vacancy, per_page)
    headers = {**_build_headers(), "Authorization": f"Bearer {token}"}

    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            return await _do_search(client, headers, text, logic, field, base_params, page)
    except Exception as exc:
        logger.error("search_resumes_page page=%d failed: %s", page, exc)
        return [], 0


async def search_resumes(vacancy: Vacancy, per_page: int = 50) -> List[Dict[str, Any]]:
    """Legacy helper — returns first page of results for backward compat."""
    result = await find_search_variant(vacancy, per_page)
    if result is None:
        return []
    _, _, _, items, _ = result
    return items


async def _get_resume_detail_single(client: httpx.AsyncClient, resume_id: str, headers: Dict):
    try:
        resp = await client.get(
            f"{settings.hh_base_url}/resumes/{resume_id}",
            headers=headers,
        )
        if resp.status_code == 200:
            return resp.json()
        if resp.status_code == 429:
            logger.warning("get_resume_detail: resume %s returned 429 (rate limited by hh.uz)", resume_id)
            return _RATE_LIMITED
        logger.warning("get_resume_detail: resume %s returned %s", resume_id, resp.status_code)
    except Exception as exc:
        logger.error("get_resume_detail: resume %s failed: %s", resume_id, exc)
    return {}


async def get_resume_detail(resume_id: str) -> Dict:
    token = await get_valid_token()
    if not token:
        return {}
    headers = {**_build_headers(), "Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(timeout=15) as client:
        return await _get_resume_detail_single(client, resume_id, headers)


async def get_resume_details_bulk(resume_ids: List[str], concurrency: int = 5) -> tuple[List[Dict], int]:
    """Fetch multiple resume details concurrently.

    Returns (results, rate_limited_count) where rate_limited_count is how many
    requests hh.uz rejected with 429.
    """
    token = await get_valid_token()
    if not token:
        return [], 0

    headers = {**_build_headers(), "Authorization": f"Bearer {token}"}
    sem = asyncio.Semaphore(concurrency)

    async def _fetch(client: httpx.AsyncClient, rid: str):
        async with sem:
            return await _get_resume_detail_single(client, rid, headers)

    async with httpx.AsyncClient(timeout=15) as client:
        raw = await asyncio.gather(*[_fetch(client, rid) for rid in resume_ids])

    rate_limited_count = sum(1 for r in raw if r is _RATE_LIMITED)
    results = [{} if r is _RATE_LIMITED else r for r in raw]
    return results, rate_limited_count
