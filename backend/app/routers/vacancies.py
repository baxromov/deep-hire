from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query

from app.schemas.vacancy import VacancyResponse, VacancyUpdate
from app.services import vacancy_service

router = APIRouter(prefix="/api/vacancies", tags=["vacancies"])


async def list_vacancies(
    status: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
):
    items, total = await vacancy_service.list_vacancies(status, skip=skip, limit=limit)
    return {"items": [VacancyResponse.from_doc(d) for d in items], "total": total}


async def create_vacancy():
    doc = await vacancy_service.create_vacancy()
    return VacancyResponse.from_doc(doc)


async def get_vacancy(vacancy_id: str):
    doc = await vacancy_service.get_vacancy(vacancy_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Vacancy not found")
    return VacancyResponse.from_doc(doc)


async def update_vacancy(vacancy_id: str, data: VacancyUpdate):
    doc = await vacancy_service.update_vacancy(vacancy_id, data)
    if not doc:
        raise HTTPException(status_code=404, detail="Vacancy not found")
    return VacancyResponse.from_doc(doc)


async def archive_vacancy(vacancy_id: str):
    doc = await vacancy_service.archive_vacancy(vacancy_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Vacancy not found")
    return VacancyResponse.from_doc(doc)


async def approve_vacancy(vacancy_id: str):
    try:
        doc = await vacancy_service.approve_vacancy(vacancy_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    if not doc:
        raise HTTPException(status_code=404, detail="Vacancy not found")
    return VacancyResponse.from_doc(doc)


async def duplicate_vacancy(vacancy_id: str):
    doc = await vacancy_service.duplicate_vacancy(vacancy_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Vacancy not found")
    return VacancyResponse.from_doc(doc)


async def toggle_open(vacancy_id: str):
    doc = await vacancy_service.toggle_open(vacancy_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Vacancy not found")
    return VacancyResponse.from_doc(doc)


router.add_api_route("/", list_vacancies, methods=["GET"])
router.add_api_route("/", create_vacancy, methods=["POST"])
router.add_api_route("/{vacancy_id}", get_vacancy, methods=["GET"])
router.add_api_route("/{vacancy_id}", update_vacancy, methods=["PUT"])
router.add_api_route("/{vacancy_id}/archive", archive_vacancy, methods=["POST"])
router.add_api_route("/{vacancy_id}/approve", approve_vacancy, methods=["POST"])
router.add_api_route("/{vacancy_id}/duplicate", duplicate_vacancy, methods=["POST"])
router.add_api_route("/{vacancy_id}/toggle-open", toggle_open, methods=["PATCH"])
