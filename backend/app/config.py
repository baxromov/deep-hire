from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Qidirish tartibi:
    #   1. Muhit o'zgaruvchilari (Docker env_file / environment bloki)
    #   2. backend/.env  — lokal ishga tushirishda backend/ papkasidagi .env
    #   3. ../.env       — lokal ishga tushirishda project root dagi yagona .env
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    mongo_uri: str = "mongodb://localhost:27017"
    mongo_db: str = "deephire"

    redis_url: str = "redis://localhost:6379"

    minio_endpoint: str = "localhost:9000"
    minio_access_key: str = ""
    minio_secret_key: str = ""
    minio_bucket: str = "deephire-uploads"
    minio_secure: bool = False

    ollama_base_url: str = "http://localhost:8080"
    ollama_model: str = "gpt-oss-120"
    litellm_api_key: str = ""
    use_llm_scoring: bool = False

    hh_client_id: str = ""
    hh_client_secret: str = ""
    hh_redirect_uri: str = ""
    hh_base_url: str = "https://api.hh.uz"
    hh_oauth_url: str = "https://hh.uz/oauth/authorize"
    hh_token_url: str = "https://hh.uz/oauth/token"
    hh_host: str = "hh.uz"

    frontend_url: str = "http://localhost:3001"

    # JWT auth
    jwt_secret: str = "change-me-in-production-very-long-secret-key-32chars"
    jwt_expire_minutes: int = 60 * 24 * 7   # 7 days

    # Required by HH API: "AppName/1.0 (your-contact)"
    app_user_agent: str = "DeepHire/1.0"

    # Smart rematch: minimum AI score (0-100) a candidate must reach to be saved
    match_min_score: int = 60

    # HH.uz area ID for all of Uzbekistan — used as default when vacancy has no area set
    uzbekistan_area_id: str = "97"

    # Qdrant vector store (Approach B — Uzbek Talent Pool)
    qdrant_url: str = "http://localhost:6333"
    qdrant_api_key: str = ""
    qdrant_collection: str = "uzbek_candidates"

    # Embedding model — served via LiteLLM (same base URL).
    # Set ollama_embed_base_url only to override with a different endpoint.
    ollama_embed_base_url: str = ""
    ollama_embed_model: str = "bge-m3:latest"

    # Pool matching params
    pool_top_k: int = 50    # candidates retrieved from Qdrant before re-scoring
    pool_top_n: int = 10    # candidates saved after Ollama re-scoring
    pool_rescore_n: int = 30  # how many Qdrant hits to send to Ollama for re-scoring

    # Smart rematch: max candidates to save per vacancy
    match_top_n: int = 10

    # Live pool matching (Stage 2 revised — ephemeral Qdrant collection per session)
    live_pool_pages: int = 20                 # 20 pages × 100 = 2000 candidates
    live_pool_per_page: int = 100             # HH.uz supports up to 100 per page
    live_pool_score_threshold: float = 0.55   # Qdrant cosine similarity gate (0.55 practical for Uzbek CVs)
    live_pool_batch_delay: float = 0.3        # seconds pause between HH detail-fetch batches (rate limit)

    # HH.uz rate-limit protection (Problems 2, 3, 5, 6, 7)
    hh_global_concurrency: int = 3       # max parallel HH API requests system-wide (central queue)
    hh_request_delay: float = 0.35       # seconds to sleep after each HH request inside the global sem
    hh_search_cache_ttl: int = 3600      # seconds to cache HH resume search results in Redis
    hh_max_search_pages: int = 3         # hard cap on pages fetched per search query
    hh_retry_backoff: list[float] = [2.0, 5.0]  # wait times between 429 retries (exponential backoff)


settings = Settings()
