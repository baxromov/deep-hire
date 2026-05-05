from datetime import datetime, timezone
from typing import List, Optional

from beanie import PydanticObjectId

from app.models.candidate import Candidate
from app.models.vacancy import Vacancy, VacancyStatus
from app.schemas.vacancy import VacancyUpdate


async def create_vacancy() -> Vacancy:
    v = Vacancy()
    await v.insert()
    return v


async def list_vacancies(status: Optional[str] = None, skip: int = 0, limit: int = 20):
    if status:
        query = {"status": status}
    else:
        query = {"status": {"$ne": "archived"}}
    total = await Vacancy.find(query).count()
    items = await Vacancy.find(query).sort("-created_at").skip(skip).limit(limit).to_list()
    return items, total


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
