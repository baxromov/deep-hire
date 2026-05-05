import logging

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import RedirectResponse

logger = logging.getLogger(__name__)

from app.config import settings
from app.schemas.hh_auth import HHLoginResponse
from app.services import hh_service

router = APIRouter(prefix="/api/auth", tags=["auth"])
_root_router = APIRouter(tags=["auth"])


async def hh_login():
    url = await hh_service.get_auth_url()
    return HHLoginResponse(auth_url=url)


async def hh_callback(code: str = Query(...)):
    try:
        token = await hh_service.exchange_code(code)
        return {"ok": True, "user": token.hh_user_name}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


async def hh_refresh():
    token_str = await hh_service.get_valid_token()
    if not token_str:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return {"ok": True}


async def hh_logout():
    await hh_service.invalidate_token()
    return {"ok": True}


async def me():
    data = await hh_service.get_me()
    if not data:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return data


async def oauth_callback(code: str = Query(...)):
    """Handles redirect from hh.uz directly to the backend (ngrok → port 8000)."""
    try:
        await hh_service.exchange_code(code)
    except Exception as exc:
        logger.error("OAuth callback failed: %s", exc, exc_info=True)
        return RedirectResponse(url=f"{settings.frontend_url}/auth/login?error=1")
    return RedirectResponse(url=f"{settings.frontend_url}/vacancies")


router.add_api_route("/hh/login", hh_login, methods=["GET"], response_model=HHLoginResponse)
router.add_api_route("/hh/callback", hh_callback, methods=["GET"])
router.add_api_route("/hh/refresh", hh_refresh, methods=["POST"])
router.add_api_route("/hh/logout", hh_logout, methods=["DELETE"])
router.add_api_route("/me", me, methods=["GET"])
_root_router.add_api_route("/callback", oauth_callback, methods=["GET"])
