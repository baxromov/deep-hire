from datetime import datetime, timedelta, timezone

from app.models.candidate import Candidate
from app.models.match_candidate_hit import MatchCandidateHit
from app.models.match_result import MatchResult
from app.models.user import User
from app.models.vacancy import Vacancy, VacancyStatus

# Vacancies with no hh_vacancy_id are the real, user-facing ones — hh-backed docs are
# hidden bookkeeping records (see vacancy_service.get_or_create_hh_vacancy) and a blank
# title means an abandoned draft never worth counting. Mirrors vacancy_service.list_vacancies.
_INTERNAL_VACANCY_FILTER = {"hh_vacancy_id": None, "title": {"$nin": [None, ""]}}


async def _group_counts(collection, match: dict, field: str) -> dict[str, int]:
    pipeline = [{"$match": match}, {"$group": {"_id": f"${field}", "count": {"$sum": 1}}}]
    out: dict[str, int] = {}
    async for row in collection.aggregate(pipeline):
        out[row["_id"] or "unknown"] = row["count"]
    return out


async def _matches_trend(match_col, match_filter: dict, days: int = 7) -> list[dict]:
    """Daily match counts for the last `days` days (oldest first) — powers the dashboard's trend chart."""
    since = (datetime.now(timezone.utc) - timedelta(days=days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
    pipeline = [
        {"$match": {**match_filter, "matched_at": {"$gte": since}}},
        {"$group": {"_id": {"$dateToString": {"format": "%Y-%m-%d", "date": "$matched_at"}}, "count": {"$sum": 1}}},
    ]
    counts = {row["_id"]: row["count"] async for row in match_col.aggregate(pipeline)}
    return [
        {"date": (since + timedelta(days=i)).strftime("%Y-%m-%d"), "count": counts.get((since + timedelta(days=i)).strftime("%Y-%m-%d"), 0)}
        for i in range(days)
    ]


async def _team_activity(vacancy_col, match_col) -> list[dict]:
    """Per-employee breakdown of vacancies created and matches run — admin-only view.
    Legacy vacancies/matches created before attribution existed have no created_by/
    matched_by and are excluded here (they still count toward the company-wide totals)."""
    vac_pipeline = [
        {"$match": {**_INTERNAL_VACANCY_FILTER, "created_by": {"$ne": None}}},
        {"$group": {"_id": "$created_by", "name": {"$first": "$created_by_name"}, "vacancies": {"$sum": 1}}},
    ]
    match_pipeline = [
        {"$match": {"matched_by": {"$ne": None}}},
        {"$group": {"_id": "$matched_by", "name": {"$first": "$matched_by_name"}, "matches": {"$sum": 1}}},
    ]
    vac_counts: dict[str, dict] = {}
    async for row in vacancy_col.aggregate(vac_pipeline):
        vac_counts[row["_id"]] = {"name": row.get("name"), "vacancies": row["vacancies"]}
    match_counts: dict[str, dict] = {}
    async for row in match_col.aggregate(match_pipeline):
        match_counts[row["_id"]] = {"name": row.get("name"), "matches": row["matches"]}

    out = []
    for uid in set(vac_counts) | set(match_counts):
        v, m = vac_counts.get(uid, {}), match_counts.get(uid, {})
        out.append({
            "user_id": uid,
            "name": v.get("name") or m.get("name") or "—",
            "vacancies": v.get("vacancies", 0),
            "matches": m.get("matches", 0),
        })
    out.sort(key=lambda x: x["vacancies"] + x["matches"], reverse=True)
    return out


async def get_dashboard_stats(current_user: User) -> dict:
    """Aggregate the project's own numbers — vacancies, candidates, matches — for the
    dashboard. Admins see the whole team's numbers plus a per-employee breakdown; staff
    see only their own vacancies/matches (candidates are a shared pool, so that section
    stays company-wide for everyone). Independent of the HH.ru quota snapshot (see
    hh_quota_service)."""
    is_admin = current_user.role == "admin"
    user_id = str(current_user.id)

    vacancy_col = Vacancy.get_motor_collection()
    candidate_col = Candidate.get_motor_collection()
    match_col = MatchResult.get_motor_collection()

    vacancy_filter = dict(_INTERNAL_VACANCY_FILTER)
    match_filter: dict = {}
    if not is_admin:
        vacancy_filter["created_by"] = user_id
        match_filter["matched_by"] = user_id

    vacancies_by_status = await _group_counts(vacancy_col, vacancy_filter, "status")
    vacancies_total = sum(vacancies_by_status.values())
    hh_tracked_filter = {"hh_vacancy_id": {"$ne": None}}
    if not is_admin:
        hh_tracked_filter["created_by"] = user_id
    hh_tracked_vacancies = await Vacancy.find(hh_tracked_filter).count()

    candidates_total = await Candidate.find_all().count()
    candidates_saved = await Candidate.find({"is_saved": True}).count()
    candidates_by_source = await _group_counts(candidate_col, {}, "raw_resume_json.source")

    matches_by_source = await _group_counts(match_col, match_filter, "source")
    matches_total = sum(matches_by_source.values())
    staged_hits_total = await MatchCandidateHit.find(match_filter).count()

    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    matches_today = await MatchResult.find({**match_filter, "matched_at": {"$gte": today_start}}).count()
    trend = await _matches_trend(match_col, match_filter)

    recent_vacancies = await Vacancy.find(
        {**vacancy_filter, "last_matched_at": {"$ne": None}}
    ).sort("-last_matched_at").limit(5).to_list()

    team_activity = await _team_activity(vacancy_col, match_col) if is_admin else None

    return {
        "scope": "admin" if is_admin else "personal",
        "vacancies": {
            "total": vacancies_total,
            "by_status": vacancies_by_status,
            "hh_tracked": hh_tracked_vacancies,
        },
        "candidates": {
            "total": candidates_total,
            "saved": candidates_saved,
            "staged": candidates_total - candidates_saved,
            "by_source": candidates_by_source,
        },
        "matches": {
            "total": matches_total,
            "by_source": matches_by_source,
            "staged_unconfirmed": staged_hits_total,
            "today": matches_today,
            "trend": trend,
        },
        "recent_activity": [
            {
                "vacancy_id": str(v.id),
                "title": v.title,
                "status": v.status.value if isinstance(v.status, VacancyStatus) else v.status,
                "last_matched_at": v.last_matched_at.isoformat() if v.last_matched_at else None,
            }
            for v in recent_vacancies
        ],
        "team_activity": team_activity,
    }
