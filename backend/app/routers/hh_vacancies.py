from typing import Optional

from fastapi import APIRouter, Query

from app.services import hh_vacancy_service, vacancy_service

router = APIRouter(prefix="/api/hh-vacancies", tags=["hh-vacancies"])


async def list_hh_vacancies(text: Optional[str] = Query(None)):
    return await hh_vacancy_service.list_vacancies_hh(text)


async def get_hh_vacancy(vacancy_id: str):
    hh = await hh_vacancy_service.get_vacancy_hh(vacancy_id)
    # Ensure a backing internal Vacancy exists so the existing matching/persistence
    # endpoints (which require a real vacancy_id) can be reused for this hh vacancy.
    vacancy = await vacancy_service.get_or_create_hh_vacancy(hh)
    return {**hh, "internal_vacancy_id": str(vacancy.id)}


router.add_api_route("/", list_hh_vacancies, methods=["GET"])
router.add_api_route("/{vacancy_id}", get_hh_vacancy, methods=["GET"])
