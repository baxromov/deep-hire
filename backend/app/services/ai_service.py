import json
import logging
import re
from typing import Any, Dict

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

_DEFAULT_CRITERIA = [
    {"name": "Соответствие должности", "weight": 45},
    {"name": "Навыки и инструменты",   "weight": 40},
    {"name": "Уровень опыта",          "weight": 15},
]


def _resolve_criteria(criteria: list | None, weights: dict | None) -> list[dict]:
    """Return normalised list of {name, weight} summing to 100."""
    if criteria and isinstance(criteria, list) and len(criteria) >= 2:
        crit = [{"name": str(c.get("name", "")), "weight": int(c.get("weight", 0))} for c in criteria]
    elif weights and isinstance(weights, dict):
        crit = [
            {"name": "Соответствие должности", "weight": int(weights.get("role", 45))},
            {"name": "Навыки и инструменты",   "weight": int(weights.get("skills", 40))},
            {"name": "Уровень опыта",          "weight": int(weights.get("experience", 15))},
        ]
    else:
        crit = [c.copy() for c in _DEFAULT_CRITERIA]

    # Normalise sum to 100
    total = sum(c["weight"] for c in crit) or 100
    if total != 100:
        for c in crit:
            c["weight"] = round(c["weight"] * 100 / total)
        crit[-1]["weight"] = 100 - sum(c["weight"] for c in crit[:-1])
    return crit


def _build_score_prompt(
    vacancy_title: str,
    vacancy_description: str,
    skills: list,
    experience: str,
    candidate_title: str,
    candidate_skills: list,
    crit: list[dict],
) -> str:
    n = len(crit)
    criteria_lines = "\n".join(
        f'{i + 1}. "{c["name"]}" (weight {c["weight"]}%)'
        for i, c in enumerate(crit)
    )
    formula = " + ".join(
        f'criteria{i + 1}*{c["weight"] / 100:.2f}'
        for i, c in enumerate(crit)
    )
    criteria_json = ",\n    ".join(
        f'{{"name": "{c["name"]}", "weight": {c["weight"]}, "score": <0-100>, "comment": "<ru>"}}'
        for c in crit
    )
    return f"""You are a senior recruiter. Evaluate how well this candidate matches the vacancy.

VACANCY:
- Title: {vacancy_title or ""}
- Required skills: {", ".join(skills[:10])}
- Experience required: {experience or ""}
- Description: {(vacancy_description or "")[:600]}

CANDIDATE:
- Job title: {candidate_title or ""}
- Skills: {", ".join(candidate_skills[:10])}

Evaluate across EXACTLY {n} criteria (0-100 each), then compute weighted total:
{criteria_lines}

For each criterion write a short comment IN RUSSIAN (1 sentence) explaining the exact reason.
Final score = round({formula}).

Return ONLY valid JSON, no markdown, no extra text:
{{
  "score": <integer 0-100>,
  "reasoning": "<1-2 sentences in Russian — overall verdict with specific facts>",
  "criteria": [
    {criteria_json}
  ]
}}"""


async def score_candidate(
    vacancy_title: str,
    required_skills: list,
    experience: str,
    candidate_title: str,
    candidate_skills: list,
    vacancy_description: str = "",
    weights: dict | None = None,
    criteria: list | None = None,
) -> tuple[int, str, list]:
    """Returns (score 0-100, reasoning string, criteria list)."""
    crit = _resolve_criteria(criteria, weights)
    prompt = _build_score_prompt(
        vacancy_title=vacancy_title,
        vacancy_description=vacancy_description,
        skills=required_skills,
        experience=experience,
        candidate_title=candidate_title,
        candidate_skills=candidate_skills,
        crit=crit,
    )
    payload = {
        "model": settings.ollama_model,
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
        "format": "json",
    }
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(f"{settings.ollama_base_url}/api/chat", json=payload)
            resp.raise_for_status()
            raw = resp.json().get("message", {}).get("content", "")
            cleaned = _strip_fences(raw)

            # Primary: strict JSON parse
            try:
                parsed = json.loads(cleaned)
            except json.JSONDecodeError:
                # Fallback: extract score with regex, skip criteria
                logger.warning("score_candidate: malformed JSON from LLM, using regex fallback. raw=%r", cleaned[:200])
                m = re.search(r'"score"\s*:\s*(\d+)', cleaned)
                score = max(0, min(100, int(m.group(1)))) if m else 0
                r = re.search(r'"reasoning"\s*:\s*"([^"]*)"', cleaned)
                reasoning = r.group(1).strip() if r else ""
                return score, reasoning, []

            score = max(0, min(100, int(parsed.get("score", 0))))
            reasoning = str(parsed.get("reasoning", "")).strip()
            criteria = parsed.get("criteria", [])
            if not isinstance(criteria, list):
                criteria = []
            return score, reasoning, criteria
    except Exception as e:
        logger.warning("score_candidate failed: %s", e)
        return 0, "", []


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

IMPORTANT: Look carefully for the candidate's full name. In Russian/Uzbek/CIS resumes the name almost always appears in the first few lines, either:
- As a standalone "Surname Firstname" line (e.g. "Иванов Иван" or "Ivanov Ivan")
- After labels like "ФИО:", "Имя:", "Name:", "Фамилия Имя:"
Try VERY hard to find a name — do NOT return null if any name-like text exists.

Return ONLY a JSON object with these exact keys (use null for missing fields):
{
  "first_name": "First name / Имя",
  "last_name": "Last name / Фамилия",
  "title": "current or desired job title",
  "skills": ["skill1", "skill2"],
  "area": "city or region",
  "salary_amount": 150000,
  "salary_currency": "UZS"
}

Rules:
- first_name / last_name: extract from ANY format (Cyrillic or Latin). Infer if possible.
- skills: list ALL technical skills, tools, languages, frameworks. Return [] if none.
- title: infer from skills/experience if not stated explicitly, never return null.
- Return ONLY the JSON, no markdown, no explanation, no thinking.
- salary_currency: UZS, RUB, USD, or EUR.

Resume text:
"""


def _heuristic_extract_name(text: str) -> tuple[str | None, str | None]:
    """Regex fallback: extract first/last name when LLM returns nothing."""
    # Label-prefixed: "ФИО: Иванов Иван" / "Name: Ivan Ivanov"
    labeled = re.search(
        r'(?:ФИО|Ф\.?И\.?О\.?|Имя и фамилия|Имя|Фамилия|Surname|Last\s*name|First\s*name|Full\s*name)[:\s]+'
        r'([А-ЯЁA-Z][а-яёa-z\-]+)(?:\s+([А-ЯЁA-Z][а-яёa-z\-]+))?',
        text[:1500], re.IGNORECASE,
    )
    if labeled:
        return labeled.group(1), labeled.group(2)

    # Standalone capitalized line in first 8 non-empty lines (2–3 words)
    for line in text.strip().split('\n')[:8]:
        line = line.strip()
        if not line or len(line) > 50:
            continue
        parts = line.split()
        if 2 <= len(parts) <= 3 and all(re.match(r'^[А-ЯЁA-Z]', p) for p in parts):
            return parts[0], parts[-1]

    return None, None


async def extract_resume_fields(text: str) -> Dict[str, Any]:
    payload = {
        "model": settings.ollama_model,
        "messages": [{"role": "user", "content": RESUME_EXTRACT_PROMPT + text[:5000]}],
        "stream": False,
        "format": "json",
    }
    result: Dict[str, Any] = {}
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(f"{settings.ollama_base_url}/api/chat", json=payload)
            resp.raise_for_status()
            raw = resp.json().get("message", {}).get("content", "")
            cleaned = _strip_fences(raw)
            parsed = json.loads(cleaned)
            result = {k: v for k, v in parsed.items() if v is not None}
    except Exception as e:
        logger.warning("extract_resume_fields LLM failed: %s | text_preview=%r", e, text[:150])

    # Ensure skills is always a list (never rely on falsy [] being filtered out)
    if not isinstance(result.get("skills"), list):
        result["skills"] = []

    # Heuristic fallback when LLM didn't find a name
    if not result.get("first_name") and not result.get("last_name"):
        first, last = _heuristic_extract_name(text)
        if first:
            result["first_name"] = first
        if last:
            result["last_name"] = last
        if first or last:
            logger.info("extract_resume_fields: heuristic name found: %r %r", first, last)
        else:
            logger.warning("extract_resume_fields: no name found | text_preview=%r", text[:200])

    return result


def _strip_fences(raw: str) -> str:
    raw = raw.strip()
    # Strip thinking/reasoning blocks — covers <think>, <thinking>, /think variants
    raw = re.sub(r"<think(?:ing)?>.*?</think(?:ing)?>", "", raw, flags=re.DOTALL)
    raw = raw.strip()
    # Strip markdown code fences
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
