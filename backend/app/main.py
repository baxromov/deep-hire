from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import close_qdrant, close_redis, init_db
from app.routers import ai, areas, candidates, matching, talent_pool, vacancies
from app.routers import auth


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield
    await close_redis()
    await close_qdrant()


app = FastAPI(title="DeepHire API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3001",
        "http://localhost:3000",
        "http://localhost:8085",
        "https://proaristocratic-sylvatic-kerstin.ngrok-free.dev",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(auth._root_router)
app.include_router(vacancies.router)
app.include_router(candidates.router)
app.include_router(matching.router)
app.include_router(talent_pool.router)
app.include_router(ai.router)
app.include_router(areas.router)


async def health():
    return {"status": "ok"}

app.add_api_route("/api/health", health, methods=["GET"])
