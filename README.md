# DeepHire

HH.uz (HeadHunter) integratsiyasiga asoslangan AI-powered recruiting platforma: vakansiyalarga eng mos nomzodlarni topish, LLM/vektor skoring bilan baholash va Cleverstaff bilan sinxronizatsiya.

## Arxitektura

```
                         ┌──────────────┐
                 8385     │    nginx     │
   Foydalanuvchi ───────► │  (reverse    │
                         │   proxy)     │
                         └──────┬───────┘
                    ┌───────────┴───────────┐
                    ▼                       ▼
            ┌───────────────┐       ┌───────────────┐
            │   frontend     │       │    backend     │
            │  Next.js 16    │──────►│   FastAPI       │
            │  (port 3001)   │  API  │  (port 8000)    │
            └───────────────┘       └───────┬────────┘
                                             │
                ┌──────────────┬─────────────┼─────────────┬──────────────┐
                ▼              ▼             ▼              ▼             ▼
            MongoDB         Redis         MinIO          Qdrant      LiteLLM/Ollama
          (asosiy DB)   (cache/lock)   (fayl saqlash)  (vektor DB)   (LLM + embedding)
```

**Backend** — FastAPI (Python 3.12, `uv`), Beanie/Motor (MongoDB ODM), Qdrant (vektor qidiruv), MinIO (rezyume fayllari), Redis, APScheduler (Cleverstaff kunlik sync), HH.uz OAuth integratsiyasi.

**Frontend** — Next.js 16 (App Router), React 19, Tailwind v4, shadcn/ui.

Nomzodlarni vakansiyaga moslashtirish usullari (Smart Rematch, Talent Pool, File Upload, Live Pool, DB Match) haqida batafsil: [`doc/matching-flow.md`](doc/matching-flow.md).

## Talab qilinadigan dasturlar

- [Docker](https://www.docker.com/) + Docker Compose
- Mahalliy ishga tushirilgan **MongoDB**, **Redis**, **MinIO**, **Qdrant** (docker-compose ularni ishga tushirmaydi — faqat `backend`/`frontend`/`nginx` ni tushiradi, qolganlarini `host.docker.internal` orqali topadi)
- Backendni Docker'siz ishga tushirish uchun: Python 3.12+ va [`uv`](https://docs.astral.sh/uv/)
- Frontendni Docker'siz ishga tushirish uchun: Node.js 20+

## Quick Start (Docker Compose)

1. `.env` faylini yarating va to'ldiring:

   ```bash
   cp .env.example .env
   ```

   Muhim maydonlar: `MONGO_USER`/`MONGO_PASSWORD`/`MONGO_URI`, `JWT_SECRET` (generatsiya: `python3 -c "import secrets; print(secrets.token_hex(32))"`), `HH_CLIENT_ID`/`HH_CLIENT_SECRET` (HH.uz OAuth), `OLLAMA_BASE_URL`/`LITELLM_API_KEY` (LLM server).

2. MongoDB, Redis, MinIO, Qdrant xizmatlarini ishga tushiring (mahalliy yoki alohida serverda) — ular `.env` dagi manzillarga mos bo'lishi kerak.

3. Backend, frontend va nginx'ni ko'taring:

   ```bash
   docker compose up --build
   ```

4. Ochish: [http://localhost:8385](http://localhost:8385)

   - API: `http://localhost:8385/api/`
   - Swagger docs: `http://localhost:8385/docs`

## Quick Start (mahalliy dev, Docker'siz)

**Backend:**

```bash
cd backend
uv sync
.venv/bin/uvicorn app.main:app --reload --port 8000
```

**Frontend:**

```bash
cd frontend
npm install
npm run dev
```

Frontend `.env`dagi `NEXT_PUBLIC_API_URL` orqali backend'ga ulanadi (mahalliyda: `http://localhost:8000`).

## Foydali buyruqlar

```bash
# Server'ga deploy qilish (Windows/PowerShell, SSH orqali)
.\deploy.ps1              # Docker cache bilan (tez)
.\deploy.ps1 -NoCache     # To'liq fresh build

# Cleverstaff sync'ni qo'lda ishga tushirish
curl -X POST http://localhost:8385/api/sync/cleverstaff

# Backend testlari/linting uchun kerakli muhitni tayyorlash
cd backend && uv sync
```

## Loyihaning tuzilishi

```
backend/        FastAPI ilova (app/{routers,services,models,schemas})
frontend/       Next.js ilova (App Router)
nginx.conf      Reverse proxy config (port 8385)
docker-compose.yml
deploy.ps1      Serverga deploy qilish skripti
doc/            Ichki hujjatlar (matching flow, muammo/yechimlar va h.k.)
```

## Qo'shimcha hujjatlar

- [`doc/matching-flow.md`](doc/matching-flow.md) — 5 xil nomzod moslashtirish usulining batafsil izohi
- [`doc/hh-rate-limit-optimizations.md`](doc/hh-rate-limit-optimizations.md) — HH.uz rate-limit bilan ishlash
- [`doc/problems-and-solutions.md`](doc/problems-and-solutions.md) — duch kelingan muammolar va yechimlar
