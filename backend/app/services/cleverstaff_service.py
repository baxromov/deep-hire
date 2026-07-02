import json
import re
import logging
from datetime import datetime, timezone

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

_MCP_TIMEOUT = 30


async def _call_mcp(arguments: dict) -> dict:
    headers = {
        "Authorization": f"Bearer {settings.cleverstaff_mcp_token}",
        "Accept": "application/json, text/event-stream",
    }

    async with httpx.AsyncClient(timeout=_MCP_TIMEOUT) as client:
        # MCP requires initialize handshake before any tool call
        init_r = await client.post(settings.cleverstaff_mcp_url, headers=headers, json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "deep-hire-backend", "version": "1.0.0"},
            },
        })
        init_r.raise_for_status()

        session_id = init_r.headers.get("Mcp-Session-Id")
        if session_id:
            headers["Mcp-Session-Id"] = session_id

        # Acknowledge initialization
        await client.post(settings.cleverstaff_mcp_url, headers=headers, json={
            "jsonrpc": "2.0",
            "method": "notifications/initialized",
        })

        # Call the tool
        r = await client.post(settings.cleverstaff_mcp_url, headers=headers, json={
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {
                "name": "search_candidates",
                "arguments": arguments,
            },
        })
        r.raise_for_status()

    data = r.json()
    raw_text = data["result"]["content"][0]["text"]
    return json.loads(raw_text)


async def fetch_candidates(offset: int = 0, limit: int = 100) -> dict:
    """Return {"total": N, "count": M, "candidates": [...]}."""
    return await _call_mcp({"limit": limit, "offset": offset})


def build_embedding_text(candidate: dict) -> str:
    parts: list[str] = []
    pos = candidate.get("position") or ""
    if pos:
        parts.extend([pos, pos])

    skills = [s["skill"] for s in candidate.get("skills", []) if s.get("skill")]
    if skills:
        skill_line = "Skills: " + ", ".join(skills[:25])
        parts.extend([skill_line, skill_line])

    for exp in candidate.get("work_experience", []):
        exp_pos = exp.get("position") or ""
        raw_desc = exp.get("description") or ""
        exp_desc = re.sub(r"<[^>]+>", " ", raw_desc).strip()[:300]
        line = " ".join(filter(None, [exp_pos, exp_desc]))
        if line:
            parts.append(line)

    return ". ".join(filter(None, parts))


def build_payload(candidate: dict) -> dict:
    """Map Cleverstaff candidate to uzbek_candidates payload schema."""
    cid = candidate.get("candidate_id", "")
    skills = [s["skill"] for s in candidate.get("skills", []) if s.get("skill")]

    # experience field is in months in Cleverstaff
    exp_months = candidate.get("experience") or 0
    experience_years = round(exp_months / 12, 1)

    salary = candidate.get("salary")
    salary_amount = int(salary) if salary is not None else None

    return {
        "hh_resume_id": f"cs:{cid}",
        "full_name": candidate.get("full_name") or "",
        "title": candidate.get("position") or "",
        "area": candidate.get("region") or "",
        "experience_years": experience_years,
        "skills": skills,
        "salary_amount": salary_amount,
        "salary_currency": candidate.get("currency"),
        "employment_type": candidate.get("employment_type") or "",
        "schedule": "",
        "last_indexed_at": datetime.now(timezone.utc).isoformat(),
        "raw_resume_json": {**candidate, "source": "cleverstaff"},
    }
