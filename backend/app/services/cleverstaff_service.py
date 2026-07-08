import json
import re
import logging
from datetime import datetime, timezone
from urllib.parse import urlparse, urlunparse

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

_MCP_TIMEOUT = 120


async def _call_mcp(arguments: dict) -> dict:
    headers = {
        "Authorization": f"Bearer {settings.cleverstaff_mcp_token}",
        "Accept": "application/json, text/event-stream",
        "Accept-Encoding": "gzip, deflate",
    }

    logger.info("MCP call → args=%s", arguments)

    _PROTOCOL_VERSION = "2025-11-25"

    async with httpx.AsyncClient(timeout=_MCP_TIMEOUT) as client:
        init_r = await client.post(settings.cleverstaff_mcp_url, headers=headers, json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": _PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {"name": "deep-hire-backend", "version": "1.0.0"},
            },
        })
        logger.info("MCP initialize → status=%d", init_r.status_code)
        init_r.raise_for_status()

        session_id = init_r.headers.get("Mcp-Session-Id")
        if session_id:
            headers["Mcp-Session-Id"] = session_id
            logger.info("MCP session_id=%s", session_id)

        headers["mcp-protocol-version"] = _PROTOCOL_VERSION

        await client.post(settings.cleverstaff_mcp_url, headers=headers, json={
            "jsonrpc": "2.0",
            "method": "notifications/initialized",
        })

        logger.info("MCP tools/call search_candidates offset=%s limit=%s",
                    arguments.get("offset"), arguments.get("limit"))
        r = await client.post(settings.cleverstaff_mcp_url, headers=headers, json={
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {
                "name": "search_candidates",
                "arguments": arguments,
            },
        })
        logger.info("MCP tools/call → status=%d content-type=%s",
                    r.status_code, r.headers.get("content-type", ""))
        r.raise_for_status()

    content_type = r.headers.get("content-type", "")
    if "text/event-stream" in content_type:
        data = _parse_sse(r.text)
    else:
        data = r.json()

    raw_text = data["result"]["content"][0]["text"]
    logger.info("MCP raw response: %s", raw_text)

    result = json.loads(raw_text)
    candidates = result.get("candidates", [])
    logger.info("MCP parsed → total=%s returned=%s", result.get("total"), len(candidates))
    for i, cand in enumerate(candidates):
        docs = cand.get("documents") or []
        logger.info(
            "  [%d] id=%s name=%r docs=%d open_urls=%s",
            i,
            cand.get("candidate_id"),
            cand.get("full_name"),
            len(docs),
            [d.get("open_url") for d in docs],
        )
    return result


def _parse_sse(body: str) -> dict:
    # SSE large payloads are split across multiple "data: " lines — join them all
    data_lines = [line[6:] for line in body.splitlines() if line.startswith("data: ")]
    if not data_lines:
        raise ValueError(f"No data line found in SSE response: {body!r}")
    return json.loads("".join(data_lines))


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


def _fix_open_url(url: str) -> str:
    """Replace 0.0.0.0 in open_url with the actual MCP server host."""
    if not url:
        return url
    parsed = urlparse(url)
    if parsed.hostname == "0.0.0.0":
        mcp = urlparse(settings.cleverstaff_mcp_url)
        fixed = parsed._replace(netloc=mcp.netloc)
        return urlunparse(fixed)
    return url


def _extract_resume_doc(candidate: dict) -> dict:
    """Return resume document metadata from candidate's documents list."""
    documents = candidate.get("documents") or []
    resume_doc = next((d for d in documents if d.get("open_url") or d.get("data_base64")), None)
    if resume_doc is None:
        return {}
    result = {
        "filename": resume_doc.get("filename") or "resume.pdf",
        "cs_mimetype": resume_doc.get("mimetype") or "application/pdf",
    }
    if resume_doc.get("open_url"):
        result["cs_open_url"] = _fix_open_url(resume_doc["open_url"])
    if resume_doc.get("data_base64"):
        result["cs_data_base64"] = resume_doc["data_base64"]
        logger.info("Resume data_base64 present for candidate id=%s (%d chars)",
                    candidate.get("candidate_id"), len(resume_doc["data_base64"]))
    return result


def build_payload(candidate: dict) -> dict:
    """Map Cleverstaff candidate to uzbek_candidates payload schema."""
    cid = candidate.get("candidate_id", "")
    skills = [s["skill"] for s in candidate.get("skills", []) if s.get("skill")]

    # experience field is in months in Cleverstaff
    exp_months = candidate.get("experience") or 0
    experience_years = round(exp_months / 12, 1)

    salary = candidate.get("salary")
    salary_amount = int(salary) if salary is not None else None

    doc_meta = _extract_resume_doc(candidate)

    # Strip large base64 blobs — use open_url to fetch on demand instead
    candidate_stripped = {k: v for k, v in candidate.items() if k != "documents"}
    if candidate.get("documents"):
        candidate_stripped["documents"] = [
            {
                k2: (_fix_open_url(v2) if k2 == "open_url" else v2)
                for k2, v2 in d.items()
                if k2 != "data_base64"
            }
            for d in candidate["documents"]
        ]

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
        "raw_resume_json": {**candidate_stripped, "source": "cleverstaff", **doc_meta},
    }
