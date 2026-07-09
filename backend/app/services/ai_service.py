import json
import logging
import re
from typing import Any, Dict, List, Optional

from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field

from app.config import settings

logger = logging.getLogger(__name__)

_llm: ChatOpenAI | None = None


def _get_llm() -> ChatOpenAI:
    global _llm
    if _llm is None:
        _llm = ChatOpenAI(
            base_url=f"{settings.ollama_base_url}/v1",
            api_key=settings.litellm_api_key or "no-key",
            model=settings.ollama_model,
            temperature=0,
        )
    return _llm


async def close_client() -> None:
    global _llm
    _llm = None


# ── Pydantic schemas for structured output ────────────────────────────────────

class ExperienceEntry(BaseModel):
    company: Optional[str] = Field(None, description="Company or organization name")
    position: Optional[str] = Field(None, description="Job title / position held")
    start: Optional[str] = Field(None, description="Start date in YYYY-MM format")
    end: Optional[str] = Field(None, description="End date in YYYY-MM format, null if current job")
    description: Optional[str] = Field(None, description="Brief description of responsibilities")


class ResumeFields(BaseModel):
    first_name: Optional[str] = Field(None, description="Candidate first name")
    last_name: Optional[str] = Field(None, description="Candidate last name")
    title: Optional[str] = Field(None, description="Current or desired job title")
    skills: List[str] = Field(default_factory=list, description="All technical skills, tools, frameworks")
    experience: List[ExperienceEntry] = Field(default_factory=list, description="Work experience history, most recent first")
    area: Optional[str] = Field(None, description="City or region")
    salary_amount: Optional[int] = Field(None, description="Expected salary amount")
    salary_currency: Optional[str] = Field(None, description="Salary currency: UZS, RUB, USD, or EUR")


class Criterion(BaseModel):
    name: str = Field(..., description="Criterion name")
    weight: int = Field(..., description="Criterion weight percentage")
    score: int = Field(..., ge=0, le=100, description="Score for this criterion, 0-100")
    comment: str = Field("", description="Short comment in Russian")


class ScoreResult(BaseModel):
    score: int = Field(..., ge=0, le=100, description="Match score 0-100")
    reasoning: str = Field(..., description="1-2 sentences in Russian explaining the verdict")
    # A fixed sub-schema (not Dict[str, Any]) so structured-output calls are forced to use
    # the "score" key consistently — an unconstrained dict let the LLM emit "value" instead
    # of "score" for some models, which the frontend doesn't read, silently hiding criteria.
    criteria: List[Criterion] = Field(default_factory=list)


class SearchQueries(BaseModel):
    queries: List[str] = Field(..., description="6 job title search queries")


class VacancyFields(BaseModel):
    title: Optional[str] = Field(None, description="Job title")
    skills: List[str] = Field(default_factory=list, description="Required skills")
    area: Optional[str] = Field(None, description="City or region")
    salary_from: Optional[int] = None
    salary_to: Optional[int] = None
    currency: Optional[str] = None
    experience: Optional[str] = None
    employment_type: Optional[str] = None
    schedule: Optional[str] = None
    description: Optional[str] = None


# ── Criteria helpers ──────────────────────────────────────────────────────────

_DEFAULT_CRITERIA = [
    {"name": "Соответствие должности", "weight": 45},
    {"name": "Навыки и инструменты",   "weight": 40},
    {"name": "Уровень опыта",          "weight": 15},
]


def _resolve_criteria(criteria: list | None, weights: dict | None) -> list[dict]:
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

    total = sum(c["weight"] for c in crit) or 100
    if total != 100:
        for c in crit:
            c["weight"] = round(c["weight"] * 100 / total)
        crit[-1]["weight"] = 100 - sum(c["weight"] for c in crit[:-1])
    return crit


# ── Resume extraction ─────────────────────────────────────────────────────────

RESUME_EXTRACT_PROMPT = """You are a recruitment assistant. Extract structured candidate information from the resume text below.

IMPORTANT rules:
- first_name / last_name: search carefully in first lines. Names appear as "Surname Firstname", after "ФИО:", "Name:", etc.
- skills: list EVERY technical skill, tool, language, framework mentioned anywhere in the resume. NEVER return empty list if any technology is mentioned.
- title: infer from experience/skills if not stated explicitly.
- salary_currency: UZS, RUB, USD, or EUR only.
- experience: extract ALL work history entries. For each entry provide: company name, position/job title, start date (YYYY-MM), end date (YYYY-MM or null if current), and a brief description of responsibilities. List most recent first.

Resume text:
{text}"""


def _heuristic_extract_name(text: str) -> tuple[str | None, str | None]:
    labeled = re.search(
        r'(?:ФИО|Ф\.?И\.?О\.?|Имя и фамилия|Имя|Фамилия|Surname|Last\s*name|First\s*name|Full\s*name)[:\s]+'
        r'([А-ЯЁA-Z][а-яёa-z\-]+)(?:\s+([А-ЯЁA-Z][а-яёa-z\-]+))?',
        text[:1500], re.IGNORECASE,
    )
    if labeled:
        return labeled.group(1), labeled.group(2)

    for line in text.strip().split('\n')[:8]:
        line = line.strip()
        if not line or len(line) > 50:
            continue
        parts = line.split()
        if 2 <= len(parts) <= 3 and all(re.match(r'^[А-ЯЁA-Z]', p) for p in parts):
            return parts[0], parts[-1]

    return None, None


def _heuristic_extract_skills(text: str) -> list[str]:
    skills: list[str] = []
    seen: set[str] = set()

    section_pattern = re.compile(
        r'(?:Key\s+skills?|Skills?|Ключевые\s+навыки|Навыки|Технологии|Стек|'
        r'Инструменты|Компетенции|Hard\s+skills?|Soft\s+skills?)'
        r'\s*[:\-–—]?\s*(.+?)(?=\n{2,}|\Z)',
        re.IGNORECASE | re.DOTALL,
    )
    for m in section_pattern.finditer(text[:6000]):
        block = m.group(1)[:800]
        tokens = re.split(r'[,;•·\n]+', block)
        for tok in tokens:
            tok = tok.strip(' \t\r•–—-/')
            if 2 <= len(tok) <= 40 and not re.search(r'\d{4}', tok):
                key = tok.lower()
                if key not in seen:
                    seen.add(key)
                    skills.append(tok)

    if not skills:
        inline = re.findall(
            r'\b(Python|Java(?:Script)?|TypeScript|C\+\+|C#|Go|Rust|Swift|Kotlin|PHP|Ruby|Scala|'
            r'React(?:\.js)?|Vue(?:\.js)?|Angular|Next\.js|Node\.js|Django|FastAPI|Flask|Spring|'
            r'PostgreSQL|MySQL|MongoDB|Redis|Elasticsearch|Kafka|RabbitMQ|'
            r'Docker|Kubernetes|Terraform|Ansible|Jenkins|GitLab\s*CI|GitHub\s*Actions|'
            r'AWS|GCP|Azure|Linux|Git|REST(?:\s*API)?|GraphQL|gRPC|'
            r'SQL|HTML|CSS|Sass|Tailwind|Bootstrap|'
            r'TensorFlow|PyTorch|scikit-learn|pandas|numpy|'
            r'Excel|Power\s*BI|Tableau|1C|SAP)\b',
            text, re.IGNORECASE,
        )
        for s in inline:
            key = s.lower()
            if key not in seen:
                seen.add(key)
                skills.append(s.strip())

    return skills[:30]


async def extract_resume_fields(text: str) -> Dict[str, Any]:
    try:
        llm = _get_llm()
        structured = llm.with_structured_output(ResumeFields)
        prompt = RESUME_EXTRACT_PROMPT.format(text=text[:5000])
        result_obj: ResumeFields = await structured.ainvoke(prompt)
        result = result_obj.model_dump(exclude_none=True)
        if "skills" not in result:
            result["skills"] = []
        logger.info("extract_resume_fields: structured output OK — skills=%d experience=%d title=%r",
                    len(result.get("skills", [])), len(result.get("experience", [])), result.get("title"))
    except Exception as e:
        logger.warning("extract_resume_fields structured LLM failed: %s", e)
        result = {}
        result["skills"] = []

    if not result.get("skills"):
        result["skills"] = _heuristic_extract_skills(text)
        if result["skills"]:
            logger.info("extract_resume_fields: heuristic skills: %d items", len(result["skills"]))

    if not result.get("first_name") and not result.get("last_name"):
        first, last = _heuristic_extract_name(text)
        if first:
            result["first_name"] = first
        if last:
            result["last_name"] = last
        if first or last:
            logger.info("extract_resume_fields: heuristic name: %r %r", first, last)
        else:
            logger.warning("extract_resume_fields: no name found | preview=%r", text[:200])

    return result


# ── Scoring ───────────────────────────────────────────────────────────────────

def _format_work_experience(work_experience: list | None) -> str:
    if not work_experience:
        return ""
    lines = []
    for entry in work_experience[:3]:
        if isinstance(entry, dict):
            company = entry.get("company") or entry.get("employer", {})
            if isinstance(company, dict):
                company = company.get("name", "")
            position = entry.get("position") or entry.get("title") or ""
            start = entry.get("start") or entry.get("from_date") or ""
            end = entry.get("end") or entry.get("to_date") or "present"
            desc = entry.get("description") or ""
            if isinstance(desc, str):
                desc = desc[:150].strip()
            period = f"{str(start)[:7]}–{str(end)[:7]}" if start else ""
            line = f"  • {company} — {position}"
            if period:
                line += f" ({period})"
            if desc:
                line += f"\n    {desc}"
            lines.append(line)
    return "\n".join(lines)


def _build_score_prompt(
    vacancy_title: str,
    vacancy_description: str,
    skills: list,
    experience: str,
    candidate_title: str,
    candidate_skills: list,
    crit: list[dict],
    work_experience: list | None = None,
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
    criteria_desc = ", ".join(
        f'name="{c["name"]}" weight={c["weight"]}'
        for c in crit
    )
    exp_block = _format_work_experience(work_experience)
    work_exp_section = f"\n- Work experience:\n{exp_block}" if exp_block else ""
    return f"""You are a senior recruiter. Evaluate how well this candidate matches the vacancy.

VACANCY:
- Title: {vacancy_title or ""}
- Required skills: {", ".join(skills[:20])}
- Experience required: {experience or ""}
- Description: {(vacancy_description or "")[:600]}

CANDIDATE:
- Job title: {candidate_title or ""}
- Skills: {", ".join(candidate_skills[:20])}{work_exp_section}

Evaluate across EXACTLY {n} criteria (0-100 each):
{criteria_lines}

Final score = round({formula}).
For each criterion write a short comment IN RUSSIAN (1 sentence).
Criteria details: {criteria_desc}"""


def _parse_score_json(raw: str, crit: list[dict]) -> tuple[int, str, list] | None:
    """Try to extract score/reasoning/criteria from a plain JSON string."""
    try:
        data = json.loads(_strip_fences(raw))
        score = int(data.get("score", 0))
        if not (0 <= score <= 100):
            return None
        reasoning = str(data.get("reasoning", ""))
        criteria_raw = data.get("criteria", [])
        parsed_crit: list[dict] = []
        if isinstance(criteria_raw, list):
            for item in criteria_raw:
                if isinstance(item, dict):
                    parsed_crit.append({
                        "name":    str(item.get("name", "")),
                        "weight":  int(item.get("weight", 0)),
                        "score":   int(item.get("score", 0)),
                        "comment": str(item.get("comment", "")),
                    })
        if not parsed_crit:
            parsed_crit = [{"name": c["name"], "weight": c["weight"], "score": score, "comment": ""} for c in crit]
        return score, reasoning, parsed_crit
    except Exception:
        return None


async def score_candidate(
    vacancy_title: str,
    required_skills: list,
    experience: str,
    candidate_title: str,
    candidate_skills: list,
    vacancy_description: str = "",
    weights: dict | None = None,
    criteria: list | None = None,
    work_experience: list | None = None,
) -> tuple[int, str, list]:
    crit = _resolve_criteria(criteria, weights)
    prompt = _build_score_prompt(
        vacancy_title=vacancy_title,
        vacancy_description=vacancy_description,
        skills=required_skills,
        experience=experience,
        candidate_title=candidate_title,
        candidate_skills=candidate_skills,
        crit=crit,
        work_experience=work_experience,
    )

    # Tier 1: structured output (function calling)
    try:
        llm = _get_llm()
        structured = llm.with_structured_output(ScoreResult)
        result_obj: ScoreResult = await structured.ainvoke(prompt)
        criteria_out = [c.model_dump() for c in result_obj.criteria] if result_obj.criteria else []
        if not criteria_out:
            criteria_out = [{"name": c["name"], "weight": c["weight"], "score": result_obj.score, "comment": ""} for c in crit]
        return result_obj.score, result_obj.reasoning, criteria_out
    except Exception as e:
        logger.warning("score_candidate structured output failed: %s | model=%s — trying plain JSON", e, settings.ollama_model)

    # Tier 2: plain chat + JSON parse
    json_prompt = (
        prompt
        + '\n\nReturn ONLY a valid JSON object (no markdown, no extra text):\n'
        '{"score": <0-100>, "reasoning": "<1-2 sentences in Russian>", '
        '"criteria": [{"name": "...", "weight": <int>, "score": <0-100>, "comment": "..."}]}'
    )
    try:
        llm = _get_llm()
        response = await llm.ainvoke(json_prompt)
        raw = response.content if hasattr(response, "content") else str(response)
        parsed = _parse_score_json(raw, crit)
        if parsed:
            logger.info("score_candidate: plain JSON fallback OK — score=%d", parsed[0])
            return parsed
        logger.warning("score_candidate: plain JSON parse returned None for response: %r", raw[:200])
    except Exception as e:
        logger.error("score_candidate: plain JSON also failed: %s", e, exc_info=True)

    return 0, "", []


# ── Search query generation ───────────────────────────────────────────────────

SEARCH_QUERIES_PROMPT = """You are a recruiting expert on hh.ru / hh.uz (CIS job boards).
Generate 6 search queries to find matching CANDIDATES for this vacancy.

CRITICAL RULE: Queries are searched against the JOB TITLE field on candidate resumes.
They MUST be job title phrases, NOT skill/tool names.

✓ GOOD: "Процессный аналитик", "IT Business Analyst", "Risk Analyst"
✗ BAD: "BPMN UML", "Jira", "Python Django"

Generate in BOTH Russian (≥3) AND English (≥2).

Vacancy title: {title}
Description: {description}
Required skills: {skills}"""


async def generate_search_queries(title: str, description: str, skills: list) -> list[str]:
    prompt = SEARCH_QUERIES_PROMPT.format(
        title=title or "",
        description=(description or "")[:800],
        skills=", ".join((skills or [])[:15]),
    )
    try:
        llm = _get_llm()
        structured = llm.with_structured_output(SearchQueries)
        result_obj: SearchQueries = await structured.ainvoke(prompt)
        seen: set[str] = set()
        return [q for q in result_obj.queries if q.strip() and not (seen.add(q) or q in seen)]
    except Exception:
        return []


# ── Vacancy extraction ────────────────────────────────────────────────────────

EXTRACT_PROMPT = """You are a recruitment assistant. Analyze this vacancy text and return ONLY a valid JSON object with no markdown, no explanation.

Required fields:
- "title": job title, explicitly stated or inferred (NEVER null or empty)
- "skills": array of ALL required/preferred skills, technologies, tools mentioned (NEVER empty if any tech mentioned)
- "description": 2-3 sentence summary — what the company does, the role, and key responsibilities

Optional fields (include only if clearly stated):
- "area": city or region
- "salary_from": number
- "salary_to": number
- "currency": "RUB" or "USD" or "EUR"
- "experience": "noExperience" or "between1And3" or "between3And6" or "moreThan6"
- "employment_type": "full" or "part" or "project" or "volunteer" or "probation"
- "schedule": "fullDay" or "shift" or "flexible" or "remote" or "flyInFlyOut"

Return ONLY the JSON object:
{text}"""


def _heuristic_title(text: str) -> str:
    for line in text.strip().split('\n')[:10]:
        line = line.strip()
        if line and 3 <= len(line) <= 80 and not line.startswith(('•', '-', '*')):
            return line
    return "Вакансия"


async def extract_fields(text: str) -> Dict[str, Any]:
    prompt = EXTRACT_PROMPT.format(text=text[:4000])

    # Tier 1: structured output (function calling)
    try:
        llm = _get_llm()
        structured = llm.with_structured_output(VacancyFields)
        result_obj: VacancyFields = await structured.ainvoke(prompt)
        fields = result_obj.model_dump(exclude_none=True)
        logger.info("extract_fields: structured output OK — title=%r skills=%d",
                    fields.get("title"), len(fields.get("skills") or []))
        if not fields.get("skills"):
            fields["skills"] = _heuristic_extract_skills(text)
        return fields
    except Exception as e:
        logger.warning("extract_fields: structured output failed (%s) — trying plain JSON", e)

    # Tier 2: plain chat call + manual JSON parse
    try:
        llm = _get_llm()
        response = await llm.ainvoke(prompt)
        raw = _strip_fences(response.content if hasattr(response, "content") else str(response))
        fields = json.loads(raw)
        logger.info("extract_fields: plain JSON OK — title=%r skills=%d",
                    fields.get("title"), len(fields.get("skills") or []))
        if not fields.get("skills"):
            fields["skills"] = _heuristic_extract_skills(text)
        return fields
    except Exception as e:
        logger.error("extract_fields: plain JSON also failed: %s", e, exc_info=True)

    # Tier 3: heuristics only
    return {
        "title": _heuristic_title(text),
        "skills": _heuristic_extract_skills(text),
        "description": "\n".join(text.strip().split('\n')[:6]).strip(),
    }


async def _infer_title(text: str) -> str:
    class TitleOnly(BaseModel):
        title: str = Field(..., description="Short job title 2-5 words")

    try:
        llm = _get_llm()
        structured = llm.with_structured_output(TitleOnly)
        result_obj: TitleOnly = await structured.ainvoke(
            f"Based on this job description, write a short job title (2-5 words).\n\n{text[:2000]}"
        )
        return result_obj.title.strip()
    except Exception:
        return ""


def _strip_fences(raw: str) -> str:
    """Legacy helper kept for any callers outside this module."""
    raw = raw.strip()
    raw = re.sub(r"<think(?:ing)?>.*?</think(?:ing)?>", "", raw, flags=re.DOTALL)
    raw = raw.strip()
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)
    raw = raw.strip()
    first_brace = raw.find('{')
    last_brace = raw.rfind('}')
    if first_brace != -1 and last_brace > first_brace:
        raw = raw[first_brace:last_brace + 1]
    return raw.strip()
