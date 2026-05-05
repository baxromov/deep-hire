from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from app.schemas.candidate import CandidateDetailResponse, CandidateResponse
from app.services import candidate_service

router = APIRouter(prefix="/api/candidates", tags=["candidates"])


async def list_candidates(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    vacancy_id: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
):
    items, total = await candidate_service.get_all_candidates(skip=skip, limit=limit, vacancy_id=vacancy_id, search=search)
    return {"items": [CandidateResponse.from_doc(d) for d in items], "total": total}


async def get_candidate(candidate_id: str):
    doc = await candidate_service.get_candidate(candidate_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Candidate not found")
    return CandidateDetailResponse.from_doc(doc)


async def candidates_by_vacancy(vacancy_id: str):
    docs = await candidate_service.get_candidates_for_vacancy(vacancy_id)
    return [CandidateResponse.from_doc(d) for d in docs]


router.add_api_route("/", list_candidates, methods=["GET"])
router.add_api_route("/vacancy/{vacancy_id}", candidates_by_vacancy, methods=["GET"])
router.add_api_route("/{candidate_id}", get_candidate, methods=["GET"])
