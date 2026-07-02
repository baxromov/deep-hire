import logging
from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse

from app.config import settings
from app.database import close_qdrant, close_redis, init_db
from app.models.user import User
from app.routers import ai, areas, candidates, matching, talent_pool, vacancies
from app.routers import auth, integrations
from app.services import ai_service, embedding_service, hh_service
from app.services.auth_service import ensure_admin_exists
from app.services.sync_service import sync_cleverstaff

logger = logging.getLogger(__name__)

_scheduler = AsyncIOScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await ensure_admin_exists()
    _scheduler.add_job(
        sync_cleverstaff,
        "cron",
        hour=settings.cleverstaff_sync_hour,
        minute=0,
        id="cleverstaff_daily_sync",
        replace_existing=True,
    )
    _scheduler.start()
    logger.info("Cleverstaff daily sync scheduled at %02d:00", settings.cleverstaff_sync_hour)
    yield
    _scheduler.shutdown(wait=False)
    await close_redis()
    await close_qdrant()
    await ai_service.close_client()
    await embedding_service.close_client()


app = FastAPI(title="DeepHire API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3001",
        "http://localhost:3000",
        "http://localhost:8385",
        "https://proaristocratic-sylvatic-kerstin.ngrok-free.dev",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(integrations.router)
app.include_router(vacancies.router)
app.include_router(candidates.router)
app.include_router(matching.router)
app.include_router(talent_pool.router)
app.include_router(ai.router)
app.include_router(areas.router)


async def health():
    return {"status": "ok"}


async def hh_oauth_callback(code: str = Query(...), state: str = Query(default="")):
    """Root /callback — registered redirect_uri in hh.uz app.
    `state` = user_id when called from integration flow.
    """
    if not state:
        # No state → unknown caller, redirect to integrations with error
        return RedirectResponse(url=f"{settings.frontend_url}/settings/integrations?error=missing_state")

    user = await User.get(state)
    if not user:
        logger.warning("HH callback: unknown state user_id=%s", state)
        return RedirectResponse(url=f"{settings.frontend_url}/settings/integrations?error=invalid_state")

    try:
        token = await hh_service.exchange_code_for_user(code, state)
        logger.info("HH account connected: user=%s hh=%s", state, token.hh_user_name)
    except Exception as exc:
        logger.error("HH callback failed: %s", exc, exc_info=True)
        return RedirectResponse(url=f"{settings.frontend_url}/settings/integrations?error=oauth_failed")

    return RedirectResponse(url=f"{settings.frontend_url}/settings/integrations?connected=1")


async def trigger_cleverstaff_sync():
    """Manually kick off the Cleverstaff sync (runs in background)."""
    import asyncio
    asyncio.create_task(sync_cleverstaff())
    return {"status": "sync started"}


app.add_api_route("/api/health", health, methods=["GET"])
app.add_api_route("/callback", hh_oauth_callback, methods=["GET"])
app.add_api_route("/api/sync/cleverstaff", trigger_cleverstaff_sync, methods=["POST"])
