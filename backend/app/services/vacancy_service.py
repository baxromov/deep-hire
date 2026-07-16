from datetime import datetime, timezone
from typing import List, Optional

from beanie import PydanticObjectId

from app.models.candidate import Candidate
from app.models.vacancy import Vacancy, VacancyStatus
from app.schemas.vacancy import VacancyUpdate
from app.services import hh_vacancy_service


async def create_vacancy() -> Vacancy:
    v = Vacancy()
    await v.insert()
    return v


async def list_vacancies(status: Optional[str] = None, skip: int = 0, limit: int = 20):
    if status:
        query = {"status": status, "hh_vacancy_id": None}
    else:
        # Aggregate "all" view — hide blank drafts (no title) so abandoned
        # create-then-never-saved vacancies don't clutter it. A specific status
        # filter (e.g. "draft") still shows everything, including blank ones,
        # so a recruiter can find their real unfinished drafts.
        query = {"status": {"$ne": "archived"}, "hh_vacancy_id": None, "title": {"$nin": [None, ""]}}
    total = await Vacancy.find(query).count()
    items = await Vacancy.find(query).sort("-created_at").skip(skip).limit(limit).to_list()
    return items, total


_HH_CURRENCY_MAP = {"RUR": "RUB"}


async def get_or_create_hh_vacancy(hh: dict) -> Vacancy:
    """Get-or-create a hidden backing Vacancy for an hh.ru vacancy, so the existing
    matching/persistence machinery (which requires a real vacancy_id) can be reused
    as-is for hh-sourced vacancies. Never surfaced as its own vacancy — excluded from
    list_vacancies via the hh_vacancy_id filter above."""
    hh_id = hh["vacancy_id"]
    salary = hh.get("salary") or {}
    currency = _HH_CURRENCY_MAP.get(salary.get("currency"), salary.get("currency")) or "UZS"

    fields = dict(
        title=hh.get("name"),
        skills=hh.get("key_skills") or [],
        area=hh.get("region"),
        salary_from=salary.get("from"),
        salary_to=salary.get("to"),
        currency=currency,
        experience=hh_vacancy_service.map_experience_to_bucket(hh.get("experience")),
        employment_type=hh.get("employment"),
        schedule=hh.get("schedule"),
        description=hh_vacancy_service.html_to_text(hh.get("description") or ""),
        raw_description=hh.get("description"),
        status=VacancyStatus.approved,
        is_open=True,
        hh_vacancy_id=hh_id,
    )

    existing = await Vacancy.find_one({"hh_vacancy_id": hh_id})
    if existing:
        for key, val in fields.items():
            setattr(existing, key, val)
        existing.updated_at = datetime.now(timezone.utc)
        await existing.save()
        return existing

    vacancy = Vacancy(**fields)
    await vacancy.insert()
    return vacancy


async def get_vacancy(vacancy_id: str) -> Optional[Vacancy]:
    return await Vacancy.get(PydanticObjectId(vacancy_id))


async def update_vacancy(vacancy_id: str, data: VacancyUpdate) -> Optional[Vacancy]:
    v = await get_vacancy(vacancy_id)
    if not v:
        return None
    update_data = data.model_dump(exclude_none=True)
    for key, val in update_data.items():
        setattr(v, key, val)
    v.updated_at = datetime.now(timezone.utc)
    await v.save()
    return v


async def approve_vacancy(vacancy_id: str) -> Optional[Vacancy]:
    v = await get_vacancy(vacancy_id)
    if not v:
        return None
    if not v.is_approvable():
        raise ValueError("Vacancy is missing required fields")
    v.status = VacancyStatus.approved
    v.updated_at = datetime.now(timezone.utc)
    await v.save()
    return v


async def duplicate_vacancy(vacancy_id: str) -> Optional[Vacancy]:
    v = await get_vacancy(vacancy_id)
    if not v:
        return None
    new_v = Vacancy(
        title=v.title,
        skills=v.skills.copy(),
        area=v.area,
        area_hh_id=v.area_hh_id,
        salary_from=v.salary_from,
        salary_to=v.salary_to,
        currency=v.currency,
        experience=v.experience,
        employment_type=v.employment_type,
        schedule=v.schedule,
        description=v.description,
        raw_description=v.raw_description,
        status=VacancyStatus.draft,
        is_open=True,
    )
    await new_v.insert()
    return new_v


async def toggle_open(vacancy_id: str) -> Optional[Vacancy]:
    v = await get_vacancy(vacancy_id)
    if not v:
        return None
    if v.status == VacancyStatus.approved:
        v.status = VacancyStatus.closed
        v.is_open = False
    elif v.status == VacancyStatus.closed:
        v.status = VacancyStatus.approved
        v.is_open = True
    v.updated_at = datetime.now(timezone.utc)
    await v.save()
    return v


async def archive_vacancy(vacancy_id: str) -> Optional[Vacancy]:
    v = await get_vacancy(vacancy_id)
    if not v:
        return None
    v.status = VacancyStatus.archived
    v.is_open = False
    v.updated_at = datetime.now(timezone.utc)
    await v.save()
    return v


def _is_deletable(v: Vacancy) -> bool:
    """A vacancy may only be hard-deleted if it's archived or still a draft (never
    published) — including drafts with real content the recruiter decided to drop,
    not just abandoned blank ones. Anything published (approved/closed) is never
    deletable this way — only archivable, since it may already have live matches."""
    return v.status in (VacancyStatus.archived, VacancyStatus.draft)


async def delete_vacancy(vacancy_id: str) -> bool:
    v = await get_vacancy(vacancy_id)
    if not v:
        return False
    if not _is_deletable(v):
        raise ValueError("Only archived or draft vacancies can be deleted")
    from app.models.match_candidate_hit import MatchCandidateHit
    from app.models.match_result import MatchResult
    await MatchResult.find({"vacancy_id": v.id}).delete()
    await MatchCandidateHit.find({"vacancy_id": v.id}).delete()
    await v.delete()
    return True


async def delete_vacancies_bulk(ids: List[str]) -> dict:
    from app.models.match_candidate_hit import MatchCandidateHit
    from app.models.match_result import MatchResult

    oids = [PydanticObjectId(i) for i in ids if i]
    vacancies = await Vacancy.find({"_id": {"$in": oids}}).to_list()
    deletable = [v for v in vacancies if _is_deletable(v)]
    skipped = len(vacancies) - len(deletable)

    deletable_ids = [v.id for v in deletable]
    if deletable_ids:
        await MatchResult.find({"vacancy_id": {"$in": deletable_ids}}).delete()
        await MatchCandidateHit.find({"vacancy_id": {"$in": deletable_ids}}).delete()
        await Vacancy.find({"_id": {"$in": deletable_ids}}).delete()

    return {"deleted": len(deletable_ids), "skipped": skipped}
