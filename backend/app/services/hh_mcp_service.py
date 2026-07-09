from app.services.cleverstaff_service import _call_mcp


async def search_candidates_hh(**filters) -> dict:
    """Search HeadHunter (hh.ru) candidates via the search_candidate_hh MCP tool.

    filters: text, region, min_experience, max_experience, min_salary, max_salary,
    currency, schedule, employment, education_level, job_search_status, label,
    relocation, gender, age_from, age_to, updated_within_days, order_by, limit, page.
    Returns {"total": N, "pages": P, "page": p, "count": M, "candidates": [...]}.
    """
    arguments = {k: v for k, v in filters.items() if v is not None}
    return await _call_mcp("search_candidate_hh", arguments)


def adapt_hh_candidate(candidate: dict) -> dict:
    """Normalize a search_candidate_hh candidate dict so candidate_service._parse_candidate
    picks up its skills and resume URL correctly (field names differ from hh.ru's native shape).
    """
    adapted = dict(candidate)
    skills = [
        s["skill"] for s in (candidate.get("skills") or [])
        if isinstance(s, dict) and s.get("skill")
    ]
    if skills:
        adapted["skill_set"] = skills
    if candidate.get("url"):
        adapted["resume_url"] = candidate["url"]
    full_name = (candidate.get("full_name") or "").strip()
    if full_name:
        parts = full_name.split(" ", 1)
        adapted["first_name"] = parts[0]
        adapted["last_name"] = parts[1] if len(parts) > 1 else None
    return adapted
