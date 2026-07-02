"""Deep-hire MCP server — Streamable HTTP transport.

POST /mcp
Authorization: Bearer <MCP_API_KEY>
Content-Type: application/json

Supported methods:
  tools/list  — list available tools
  tools/call  — call a tool (only search_candidates)
"""
import json
import logging
import re
from typing import Any

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import JSONResponse

from app.config import settings
from app.database import get_qdrant
from app.services import embedding_service
from app.services.qdrant_service import search_candidates as qdrant_search

logger = logging.getLogger(__name__)

router = APIRouter(tags=["mcp"])

# ── Tool schema (same format Cleverstaff uses so Claude treats them identically)
_SEARCH_CANDIDATES_SCHEMA = {
    "name": "search_candidates",
    "description": (
        "Search the Deep-hire candidates database and get full profiles. "
        "Returns the top matching candidates sorted by relevance.\n\n"
        "FILTERS (all optional, AND-combined):\n"
        "- query: free-text over name/position/workplace/skills\n"
        "- region: city or country (partial)\n"
        "- min_salary / max_salary + currency\n"
        "- employment_type: full-time | remote | contract | part-time | freelance\n"
        "- skills: list of required skill names (ALL must match)\n"
        "- min_experience / max_experience (years)\n"
        "- source: 'hh' | 'file' | 'xlsx' | 'cleverstaff'\n\n"
        "PAGINATION: limit (default 20, max 100), offset (default 0).\n"
        "RETURNS: total, count, candidates (with full profile)."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "query":           {"type": "string",  "description": "Free-text search"},
            "region":          {"type": "string",  "description": "City or country (partial)"},
            "min_salary":      {"type": "number",  "description": "Minimum salary"},
            "max_salary":      {"type": "number",  "description": "Maximum salary"},
            "currency":        {"type": "string",  "enum": ["UZS", "USD", "EUR", "RUB"]},
            "employment_type": {"type": "string",  "enum": ["full-time", "remote", "contract", "part-time", "freelance"]},
            "skills":          {"type": "array",   "items": {"type": "string"}},
            "min_experience":  {"type": "integer", "description": "Min years of experience"},
            "max_experience":  {"type": "integer", "description": "Max years of experience"},
            "source":          {"type": "string",  "description": "Data source filter"},
            "limit":           {"type": "integer", "minimum": 1, "maximum": 100},
            "offset":          {"type": "integer", "minimum": 0},
        },
    },
}


# ── Auth ──────────────────────────────────────────────────────────────────────

def _check_auth(request: Request) -> None:
    if not settings.mcp_api_key:
        return  # auth disabled
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing Bearer token")
    token = auth_header.removeprefix("Bearer ").strip()
    if token != settings.mcp_api_key:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")


# ── Tool handler ──────────────────────────────────────────────────────────────

def _strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", " ", text).strip()


def _format_candidate(payload: dict) -> dict:
    raw = payload.get("raw_resume_json") or {}
    skills_raw = payload.get("skills") or []

    work_experience = []
    for exp in (raw.get("experience") or raw.get("work_experience") or []):
        work_experience.append({
            "from_date":   exp.get("start") or exp.get("from_date"),
            "to_date":     exp.get("end")   or exp.get("to_date"),
            "company":     exp.get("employer", {}).get("name") if isinstance(exp.get("employer"), dict) else exp.get("company"),
            "position":    exp.get("position"),
            "description": _strip_html(exp.get("description") or "")[:400],
        })

    return {
        "candidate_id":      payload.get("hh_resume_id", ""),
        "full_name":         payload.get("full_name", ""),
        "position":          payload.get("title", ""),
        "region":            payload.get("area", ""),
        "experience_years":  payload.get("experience_years", 0),
        "salary":            payload.get("salary_amount"),
        "currency":          payload.get("salary_currency"),
        "employment_type":   payload.get("employment_type", ""),
        "source":            raw.get("source", ""),
        "skills":            [{"skill": s} for s in skills_raw],
        "work_experience":   work_experience,
        "relevance_score":   round((payload.get("_qdrant_score") or 0) * 100),
    }


async def _handle_search_candidates(args: dict) -> dict:
    query: str       = args.get("query") or ""
    region: str      = args.get("region") or ""
    min_salary       = args.get("min_salary")
    max_salary       = args.get("max_salary")
    skills: list     = [s.lower() for s in (args.get("skills") or [])]
    min_exp          = args.get("min_experience")
    max_exp          = args.get("max_experience")
    emp_type: str    = args.get("employment_type") or ""
    source: str      = args.get("source") or ""
    limit: int       = min(int(args.get("limit") or 20), 100)
    offset: int      = max(int(args.get("offset") or 0), 0)

    # Build search text — use query or fallback to a generic prompt
    search_text = query or "candidate"
    query_vector = await embedding_service.embed(search_text)

    qdrant = await get_qdrant()
    # Fetch enough hits to support pagination
    top_k = min(limit + offset + 50, 200)
    hits = await qdrant_search(
        client=qdrant,
        query_vector=query_vector,
        top_k=top_k,
        area_filter=region or None,
        min_salary=int(min_salary) if min_salary is not None else None,
        max_salary=int(max_salary) if max_salary is not None else None,
    )

    # Post-filter
    def _matches(p: dict) -> bool:
        raw = p.get("raw_resume_json") or {}
        if skills:
            candidate_skills = {s.lower() for s in (p.get("skills") or [])}
            if not all(s in candidate_skills for s in skills):
                return False
        if min_exp is not None and (p.get("experience_years") or 0) < min_exp:
            return False
        if max_exp is not None and (p.get("experience_years") or 0) > max_exp:
            return False
        if emp_type and p.get("employment_type", "").lower() != emp_type.lower():
            return False
        if source and raw.get("source", "").lower() != source.lower():
            return False
        return True

    filtered = [h for h in hits if _matches(h)]
    total = len(filtered)
    page = filtered[offset:offset + limit]

    return {
        "total":      total,
        "count":      len(page),
        "limit":      limit,
        "offset":     offset,
        "candidates": [_format_candidate(p) for p in page],
    }


# ── Main MCP endpoint ─────────────────────────────────────────────────────────

@router.post("/mcp")
async def mcp_endpoint(request: Request) -> JSONResponse:
    _check_auth(request)

    try:
        body: dict[str, Any] = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    method = body.get("method", "")
    params = body.get("params") or {}

    # ── tools/list ────────────────────────────────────────────────────────────
    if method == "tools/list":
        return JSONResponse({"tools": [_SEARCH_CANDIDATES_SCHEMA]})

    # ── tools/call ────────────────────────────────────────────────────────────
    if method == "tools/call":
        tool_name = params.get("name", "")
        arguments = params.get("arguments") or {}

        if tool_name != "search_candidates":
            return JSONResponse({
                "content": [{"type": "text", "text": f"Unknown tool: {tool_name}"}],
                "isError": True,
            })

        try:
            result = await _handle_search_candidates(arguments)
            return JSONResponse({
                "content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}],
                "isError": False,
            })
        except Exception as exc:
            logger.error("MCP search_candidates error: %s", exc, exc_info=True)
            return JSONResponse({
                "content": [{"type": "text", "text": str(exc)}],
                "isError": True,
            })

    raise HTTPException(status_code=400, detail=f"Unsupported method: {method}")
