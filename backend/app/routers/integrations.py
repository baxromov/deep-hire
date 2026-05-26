"""HH.uz integration management — per-user, multi-account."""
import logging
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse

from app.config import settings
from app.dependencies import get_current_user
from app.models.hh_token import HHToken
from app.models.user import User
from app.services import hh_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/integrations", tags=["integrations"])


# ── HH.uz ─────────────────────────────────────────────────────────────────────

@router.get("/hh")
async def list_hh_accounts(current_user: User = Depends(get_current_user)):
    """Return all HH accounts connected by the current user."""
    tokens = await HHToken.find(HHToken.user_id == str(current_user.id)).to_list()
    return [
        {
            "id": str(t.id),
            "label": t.label or t.hh_user_name or t.employer_name,
            "hh_user_id": t.hh_user_id,
            "hh_user_name": t.hh_user_name,
            "email": t.email,
            "employer_id": t.employer_id,
            "employer_name": t.employer_name,
            "is_employer": t.is_employer,
        }
        for t in tokens
    ]


@router.get("/hh/connect-url")
async def get_hh_connect_url(current_user: User = Depends(get_current_user)):
    """Return the HH OAuth URL. State encodes the user_id so the callback knows who to link."""
    state = str(current_user.id)
    params = {
        "response_type": "code",
        "client_id": settings.hh_client_id,
        "redirect_uri": settings.hh_redirect_uri,
        "skip_choose_account": "false",   # let user pick which HH account
        "role": "employer",
        "state": state,
    }
    url = f"{settings.hh_oauth_url}?{urlencode(params)}"
    return {"auth_url": url}


@router.get("/hh/callback")
async def hh_oauth_callback(code: str = Query(...), state: str = Query(...)):
    """HH redirects here after user authorizes. state = user_id."""
    user_id = state
    user = await User.get(user_id)
    if not user:
        return RedirectResponse(url=f"{settings.frontend_url}/settings/integrations?error=invalid_state")

    try:
        token = await hh_service.exchange_code_for_user(code, user_id)
        logger.info("HH account connected: user=%s hh_user=%s", user_id, token.hh_user_name)
    except Exception as exc:
        logger.error("HH OAuth callback failed: %s", exc, exc_info=True)
        return RedirectResponse(url=f"{settings.frontend_url}/settings/integrations?error=oauth_failed")

    return RedirectResponse(url=f"{settings.frontend_url}/settings/integrations?connected=1")


@router.delete("/hh/{token_id}", status_code=204)
async def disconnect_hh_account(token_id: str, current_user: User = Depends(get_current_user)):
    token = await HHToken.get(token_id)
    if not token:
        raise HTTPException(status_code=404, detail="Аккаунт не найден")
    if token.user_id != str(current_user.id):
        raise HTTPException(status_code=403, detail="Нет доступа")
    await token.delete()
