import json
import re
from typing import Any, Dict

import httpx

from app.config import settings

SCORE_PROMPT = """You are a recruiter. Score how well this candidate matches the vacancy (0-100).

Scoring guide:
- 85-100: Excellent match — right role, most required skills present
- 70-84:  Good match — similar role, key skills overlap
- 50-69:  Partial match — related role or some key skills, but gaps exist
- 0-49:   Poor match — wrong role or very few relevant skills

Focus on ROLE alignment first, then skills. A candidate with the right job title but missing
1-2 tools can still score 75+. Do NOT penalize for missing "nice to have" items.

Vacancy: {vacancy_title}
Core skills required: {skills}
Experience level: {experience}
Context (use for role alignment only): {vacancy_description}

Candidate job title: {candidate_title}
Candidate skills: {candidate_skills}

Return ONLY JSON:
{{"score": <integer 0-100>}}"""


async def score_candidate(
    vacancy_title: str,
    required_skills: list,
    experience: str,
    candidate_title: str,
    candidate_skills: list,
    vacancy_description: str = "",
) -> int:
    prompt = SCORE_PROMPT.format(
        vacancy_title=vacancy_title or "",
        vacancy_description=(vacancy_description or "")[:600],
        skills=", ".join(required_skills[:10]),
        experience=experience or "",
        candidate_title=candidate_title or "",
        candidate_skills=", ".join(candidate_skills[:10]),
    )
    payload = {
        "model": settings.ollama_model,
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
        "format": "json",
    }
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(f"{settings.ollama_base_url}/api/chat", json=payload)
            resp.raise_for_status()
            raw = resp.json().get("message", {}).get("content", "")
            parsed = json.loads(_strip_fences(raw))
            return max(0, min(100, int(parsed.get("score", 0))))
    except Exception:
        return 0


SEARCH_QUERIES_PROMPT = """You are a recruiting expert on hh.ru / hh.uz (CIS job boards).
Generate 6 search queries to find matching CANDIDATES for this vacancy.

CRITICAL RULE: These queries are searched against the JOB TITLE field on candidate resumes.
They MUST be job title phrases — words a candidate writes as their position name.

✓ GOOD queries (job title phrases):
  "Процессный аналитик", "ITSM консультант", "IT Business Analyst", "Risk Analyst"

✗ BAD queries (skill/tool names — will return 0 results):
  "BPMN UML RACI", "Jira Service Management", "Python Django", "SQL Excel"

LANGUAGE RULE: Generate queries in BOTH Russian AND English.
- At least 3 queries in Russian (how candidates write titles in CIS)
- At least 2 queries in English (many CIS candidates use English job titles)
- Mix specific → general across both languages

Vacancy title: {title}
Description: {description}
Required skills: {skills}

Think: what JOB TITLES do candidates who do this work write on their resumes — in Russian AND English?

Return ONLY JSON, no explanation:
{{"queries": ["ru specific", "ru synonym", "ru general", "en specific", "en synonym", "en general"]}}"""


async def generate_search_queries(
    title: str,
    description: str,
    skills: list,
) -> list[str]:
    """Ask the LLM for smart, semantically varied HH search queries for this vacancy."""
    prompt = SEARCH_QUERIES_PROMPT.format(
        title=title or "",
        description=(description or "")[:800],
        skills=", ".join((skills or [])[:15]),
    )
    payload = {
        "model": settings.ollama_model,
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
        "format": "json",
    }
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(f"{settings.ollama_base_url}/api/chat", json=payload)
            resp.raise_for_status()
            raw = resp.json().get("message", {}).get("content", "")
            parsed = json.loads(_strip_fences(raw))
            queries = parsed.get("queries", [])
            # Validate: must be non-empty strings, deduplicated
            seen: set[str] = set()
            result = []
            for q in queries:
                q = str(q).strip()
                if q and q not in seen:
                    seen.add(q)
                    result.append(q)
            return result
    except Exception:
        return []


EXTRACT_PROMPT = """You are a recruitment assistant. Extract structured vacancy information from the given text.

Return ONLY a JSON object with these exact keys (use null for missing fields):
{
  "title": "job title",
  "skills": ["skill1", "skill2"],
  "area": "city or region name",
  "salary_from": 100000,
  "salary_to": 150000,
  "currency": "RUB",
  "experience": "noExperience|between1And3|between3And6|moreThan6",
  "employment_type": "full|part|project|volunteer|probation",
  "schedule": "fullDay|shift|flexible|remote|flyInFlyOut",
  "description": "cleaned job description"
}

Rules:
- title: extract the job title if explicitly stated. If NOT stated, infer a concise job title (2-5 words) from the responsibilities, required skills, and context — NEVER return null for title.
- experience must be one of: noExperience, between1And3, between3And6, moreThan6
- employment_type must be one of: full, part, project, volunteer, probation
- schedule must be one of: fullDay, shift, flexible, remote, flyInFlyOut
- currency should be RUB, USD, or EUR
- Return ONLY the JSON, no markdown, no explanation

Text to extract from:
"""


RESUME_EXTRACT_PROMPT = """You are a recruitment assistant. Extract structured candidate information from the given resume text.

Return ONLY a JSON object with these exact keys (use null for missing fields):
{
  "first_name": "First name",
  "last_name": "Last name",
  "title": "current or desired job title",
  "skills": ["skill1", "skill2"],
  "area": "city or region",
  "salary_amount": 150000,
  "salary_currency": "UZS"
}

Rules:
- Return ONLY the JSON, no markdown, no explanation
- salary_currency should be UZS, RUB, USD, or EUR

Resume text:
"""


async def extract_resume_fields(text: str) -> Dict[str, Any]:
    payload = {
        "model": settings.ollama_model,
        "messages": [{"role": "user", "content": RESUME_EXTRACT_PROMPT + text[:4000]}],
        "stream": False,
        "format": "json",
    }
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(f"{settings.ollama_base_url}/api/chat", json=payload)
            resp.raise_for_status()
            raw = resp.json().get("message", {}).get("content", "")
            parsed = json.loads(_strip_fences(raw))
            return {k: v for k, v in parsed.items() if v is not None}
    except Exception:
        return {}


def _strip_fences(raw: str) -> str:
    raw = raw.strip()
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)
    return raw.strip()


async def _infer_title(text: str) -> str:
    """Fallback: ask the model for just a job title when extraction returned none."""
    payload = {
        "model": settings.ollama_model,
        "messages": [{
            "role": "user",
            "content": (
                "Based on this job description, write a short job title (2-5 words). "
                "Return ONLY JSON: {\"title\": \"...\"}.\n\n" + text[:2000]
            ),
        }],
        "stream": False,
        "format": "json",
    }
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(f"{settings.ollama_base_url}/api/chat", json=payload)
            resp.raise_for_status()
            raw = resp.json().get("message", {}).get("content", "")
            parsed = json.loads(_strip_fences(raw))
            title = str(parsed.get("title", "")).strip()
            return title if title else ""
    except Exception:
        return ""


async def extract_fields(text: str) -> Dict[str, Any]:
    payload = {
        "model": settings.ollama_model,
        "messages": [{"role": "user", "content": EXTRACT_PROMPT + text[:4000]}],
        "stream": False,
        "format": "json",
    }

    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                f"{settings.ollama_base_url}/api/chat",
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()
            raw_content = data.get("message", {}).get("content", "")
            cleaned = _strip_fences(raw_content)
            parsed = json.loads(cleaned)
            fields = {k: v for k, v in parsed.items() if v is not None}

            # Safety net: if title still missing, infer it from the description
            if not fields.get("title"):
                inferred = await _infer_title(fields.get("description") or text)
                if inferred:
                    fields["title"] = inferred

            return fields
    except Exception:
        return {}
