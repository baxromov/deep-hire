import json
import re
import logging
import httpx

from app.config import settings

logger = logging.getLogger(__name__)

_MCP_TIMEOUT = 30


async def _call_mcp(arguments: dict) -> dict:
    payload = {
        "method": "tools/call",
        "params": {
            "name": "search_candidates",
            "arguments": arguments,
        },
    }
    headers = {"Authorization": f"Bearer {settings.cleverstaff_mcp_token}"}
    async with httpx.AsyncClient(timeout=_MCP_TIMEOUT) as client:
        r = await client.post(settings.cleverstaff_mcp_url, json=payload, headers=headers)
        r.raise_for_status()
    data = r.json()
    raw_text = data["content"][0]["text"]
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
    skills = [s["skill"] for s in candidate.get("skills", []) if s.get("skill")]
    return {
        "candidate_id": candidate.get("candidate_id", ""),
        "full_name": candidate.get("full_name"),
        "position": candidate.get("position"),
        "current_position": candidate.get("current_position"),
        "region": candidate.get("region"),
        "employment_type": candidate.get("employment_type") or "",
        "sex": candidate.get("sex"),
        "experience": candidate.get("experience"),
        "salary": candidate.get("salary"),
        "currency": candidate.get("currency"),
        "skills": skills,
        "industry": candidate.get("industry"),
        "role_level": candidate.get("role_level"),
        "source": "cleverstaff",
    }
