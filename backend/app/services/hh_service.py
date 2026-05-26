import asyncio
import hashlib
import json
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
_SEARCH_CACHE_PREFIX = "hh:search:"

_RATE_LIMITED = object()  # sentinel for 429 responses from hh.uz

# ---------------------------------------------------------------------------
# Global HH rate-limit guard (Problem 2 & 7: central queue, max concurrency)
# ---------------------------------------------------------------------------
_HH_SEM: Optional[asyncio.Semaphore] = None


def _get_hh_sem() -> asyncio.Semaphore:
    global _HH_SEM
    if _HH_SEM is None:
        _HH_SEM = asyncio.Semaphore(settings.hh_global_concurrency)
    return _HH_SEM


async def _guarded_get(client: httpx.AsyncClient, url: str, **kwargs) -> httpx.Response:
    """All HH API GETs go through here: global concurrency cap + inter-request delay."""
    async with _get_hh_sem():
        resp = await client.get(url, **kwargs)
        await asyncio.sleep(settings.hh_request_delay)
        return resp


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


async def _exchange_code_raw(code: str) -> tuple[dict, dict]:
    """Exchange OAuth code for token data. Returns (token_data, user_info)."""
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

    try:
        user_info = await _fetch_me(data["access_token"])
    except Exception:
        user_info = {}

    return data, user_info


async def exchange_code_for_user(code: str, user_id: str) -> HHToken:
    """Exchange OAuth code and link the resulting token to a specific user.
    If a token for the same HH account already exists for this user, it is replaced.
    """
    data, user_info = await _exchange_code_raw(code)
    expires_at = _utcnow() + timedelta(seconds=data["expires_in"])
    employer = user_info.get("employer") or {}
    hh_user_id = str(user_info.get("id") or "")

    # Replace existing token for same HH account (avoid duplicates)
    if hh_user_id:
        await HHToken.find(
            HHToken.user_id == user_id,
            HHToken.hh_user_id == hh_user_id,
        ).delete()

    token = HHToken(
        user_id=user_id,
        access_token=data["access_token"],
        refresh_token=data["refresh_token"],
        expires_at=expires_at,
        hh_user_id=hh_user_id,
        hh_user_name=f"{user_info.get('first_name') or ''} {user_info.get('last_name') or ''}".strip(),
        email=user_info.get("email") or "",
        phone=user_info.get("phone") or "",
        is_employer=bool(user_info.get("is_employer")),
        employer_id=str(employer.get("id") or ""),
        employer_name=employer.get("name") or "",
    )
    await token.insert()

    # Cache under user-scoped key
    redis = await get_redis()
    ttl = max(1, int((expires_at - _utcnow()).total_seconds()) - 300)
    await redis.set(f"hh:token:{user_id}", data["access_token"], ex=ttl)

    return token


async def exchange_code(code: str) -> HHToken:
    """Legacy — kept for backward compat. Uses system user_id='system'."""
    return await exchange_code_for_user(code, "system")


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


async def get_valid_token(user_id: Optional[str] = None) -> Optional[str]:
    """Return a valid access token.

    If user_id is given, prefer a token owned by that user.
    Falls back to any available token (for legacy callers that don't pass user_id).
    """
    redis = await get_redis()
    # Try user-scoped cache first
    if user_id:
        cached = await redis.get(f"hh:token:{user_id}")
        if cached:
            return cached

    # Legacy global cache
    cached = await redis.get(REDIS_TOKEN_KEY)
    if cached:
        return cached

    # Load from DB
    if user_id:
        token = await HHToken.find_one(HHToken.user_id == user_id)
    else:
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


def _search_cache_key(text: str, logic: str, field: str, base_params: Dict, page: int) -> str:
    """Stable Redis key for a search request (Problem 3: result caching)."""
    key_data = {
        "text": text, "logic": logic, "field": field, "page": page,
        "area": base_params.get("area"),
        "experience": base_params.get("experience"),
        "employment": base_params.get("employment"),
        "per_page": base_params.get("per_page"),
    }
    digest = hashlib.md5(json.dumps(key_data, sort_keys=True).encode()).hexdigest()
    return f"{_SEARCH_CACHE_PREFIX}{digest}"


async def _do_search(
    client: httpx.AsyncClient,
    headers: Dict,
    text: str,
    logic: str,
    field: str,
    base_params: Dict[str, Any],
    page: int = 0,
) -> tuple[List[Dict], int]:
    """Returns (items, total_pages). Checks Redis cache before hitting HH."""
    # Problem 3: serve from cache when available
    cache_key = _search_cache_key(text, logic, field, base_params, page)
    redis = await get_redis()
    cached = await redis.get(cache_key)
    if cached:
        data = json.loads(cached)
        logger.debug("_do_search: cache hit for %r page=%d", text, page)
        return data["items"], data["pages"]

    params = {**base_params, "text": text, "text.logic": logic, "text.period": "", "page": page}
    if field:
        params["text.field"] = field
    # Problem 2 & 7: all requests go through the global guard
    resp = await _guarded_get(client, f"{settings.hh_base_url}/resumes", params=params, headers=headers)
    if resp.status_code != 200:
        logger.error("_do_search: HH returned %s — %s", resp.status_code, resp.text[:200])
        return [], 0
    data = resp.json()
    items, pages = data.get("items", []), data.get("pages", 1)

    # Store in Redis for future identical queries
    await redis.set(
        cache_key,
        json.dumps({"items": items, "pages": pages}),
        ex=settings.hh_search_cache_ttl,
    )
    return items, pages


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
    probe_params = {**base_params, "per_page": 1}  # Problem 1: light-check params
    headers = {**_build_headers(), "Authorization": f"Bearer {token}"}

    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            for text, logic, field in _title_variants(vacancy.title):
                logger.info(
                    "find_search_variant: probe text=%r logic=%s field=%s",
                    text, logic, field or "all_fields",
                )
                # Problem 1: light check — per_page=1 to confirm results exist cheaply
                probe_items, _ = await _do_search(
                    client, headers, text, logic, field, probe_params, page=0
                )
                if not probe_items:
                    logger.info("find_search_variant: 0 results on probe, trying next variant")
                    continue

                # Results confirmed — now fetch full page
                items, total_pages = await _do_search(
                    client, headers, text, logic, field, base_params, page=0
                )
                if items:
                    logger.info(
                        "find_search_variant: %d results, total_pages=%d for text=%r",
                        len(items), total_pages, text,
                    )
                    return text, logic, field, items, total_pages
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
    """Fetch one resume detail with exponential backoff on 429 (Problem 5).

    Uses the global guard (_guarded_get) for system-wide rate limiting.
    """
    url = f"{settings.hh_base_url}/resumes/{resume_id}"
    backoffs = settings.hh_retry_backoff  # e.g. [2.0, 5.0]
    for attempt in range(len(backoffs) + 1):
        try:
            resp = await _guarded_get(client, url, headers=headers)
            if resp.status_code == 200:
                return resp.json()
            if resp.status_code == 429:
                if attempt < len(backoffs):
                    wait = backoffs[attempt]
                    logger.warning(
                        "resume %s → 429, backoff %.1fs (attempt %d/%d)",
                        resume_id, wait, attempt + 1, len(backoffs) + 1,
                    )
                    await asyncio.sleep(wait)
                    continue
                logger.warning("resume %s → 429 after %d attempts, skipping", resume_id, attempt + 1)
                return _RATE_LIMITED
            logger.warning("resume %s returned %s", resume_id, resp.status_code)
            return {}
        except Exception as exc:
            logger.error("resume %s failed: %s", resume_id, exc)
            return {}
    return _RATE_LIMITED


async def get_resume_detail(resume_id: str) -> Dict:
    token = await get_valid_token()
    if not token:
        return {}
    headers = {**_build_headers(), "Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(timeout=15) as client:
        return await _get_resume_detail_single(client, resume_id, headers)


async def get_resume_details_bulk(resume_ids: List[str], concurrency: int = 5) -> tuple[List[Dict], int]:
    """Fetch multiple resume details concurrently.

    concurrency is a per-call soft limit; the global _HH_SEM is the hard system cap.
    Returns (results, rate_limited_count).
    """
    token = await get_valid_token()
    if not token:
        return [], 0

    headers = {**_build_headers(), "Authorization": f"Bearer {token}"}
    # Local sem limits task fan-out; global sem (_guarded_get) limits actual HH traffic
    local_sem = asyncio.Semaphore(concurrency)

    async def _fetch(client: httpx.AsyncClient, rid: str):
        async with local_sem:
            return await _get_resume_detail_single(client, rid, headers)

    async with httpx.AsyncClient(timeout=15) as client:
        raw = await asyncio.gather(*[_fetch(client, rid) for rid in resume_ids])

    rate_limited_count = sum(1 for r in raw if r is _RATE_LIMITED)
    results = [{} if r is _RATE_LIMITED else r for r in raw]
    return results, rate_limited_count
