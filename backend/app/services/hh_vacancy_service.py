import re

from app.services.cleverstaff_service import _call_mcp

# hh.ru's own dictionary strings for the experience filter buckets — reversed here
# so a fetched vacancy's free-text experience can drive the same bucket our own
# Vacancy.experience enum (and embedding_service.build_vacancy_text's exp_map) uses.
_HH_EXPERIENCE_LABEL_TO_BUCKET = {
    "Нет опыта": "noExperience",
    "От 1 года до 3 лет": "between1And3",
    "От 3 до 6 лет": "between3And6",
    "Более 6 лет": "moreThan6",
}


async def list_vacancies_hh(text: str | None = None) -> dict:
    """List the company's open vacancies on hh.ru via the list_vacancies_hh MCP tool."""
    arguments = {"text": text} if text else {}
    return await _call_mcp("list_vacancies_hh", arguments)


async def get_vacancy_hh(vacancy_id: str) -> dict:
    """Fetch full details for one hh.ru vacancy via the get_vacancy_hh MCP tool."""
    return await _call_mcp("get_vacancy_hh", {"vacancy_id": vacancy_id})


async def get_vacancy_responses_hh(hh_vacancy_id: str, limit: int = 5) -> dict:
    """Applicants who already applied to this hh.ru vacancy, full profiles (skills,
    work history) via the vacancy_responses_hh MCP tool. detail="full" is capped at
    5 by the tool itself (hh.ru per-resume view quota) — total/by_state stay exact
    regardless."""
    return await _call_mcp("vacancy_responses_hh", {
        "vacancy_id": hh_vacancy_id,
        "limit": min(limit, 5),
        "detail": "full",
    })


def adapt_hh_applicant(applicant: dict) -> dict:
    """Normalize a vacancy_responses_hh applicant into the resume-dict shape
    candidate_service._parse_candidate expects (id/first_name/last_name/gender/resume_url) —
    mirrors hh_mcp_service.adapt_hh_candidate for search_candidate_hh results. Skills
    (`[{"skill": ...}]`), salary/currency and region are already in a shape
    _parse_candidate understands, so they pass through via **applicant unchanged.
    """
    full_name = (applicant.get("full_name") or "").strip()
    first, _, last = full_name.partition(" ")
    return {
        **applicant,
        "id": applicant.get("resume_id"),
        "first_name": first or None,
        "last_name": last or None,
        "gender": applicant.get("sex"),
        "resume_url": applicant.get("url"),
    }


def html_to_text(html: str) -> str:
    """Strip hh.ru's posting HTML down to plain text, keeping paragraph breaks."""
    if not html:
        return ""
    text = re.sub(r"<(br|/p|/li|/h[1-6])\s*/?>", "\n", html, flags=re.IGNORECASE)
    text = re.sub(r"<li[^>]*>", "• ", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    text = (
        text.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
    )
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def map_experience_to_bucket(label: str | None) -> str | None:
    """Reverse-map hh.ru's free-text experience label to our internal enum bucket."""
    return _HH_EXPERIENCE_LABEL_TO_BUCKET.get((label or "").strip())
