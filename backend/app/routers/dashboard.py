from fastapi import APIRouter, Depends

from app.dependencies import get_current_user
from app.models.user import User
from app.services import dashboard_service, hh_quota_service

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/hh-quota")
async def hh_quota(_: User = Depends(get_current_user)):
    return await hh_quota_service.get_quota_hh()


@router.get("/stats")
async def stats(current_user: User = Depends(get_current_user)):
    return await dashboard_service.get_dashboard_stats(current_user)
