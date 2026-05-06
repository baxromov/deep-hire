from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    mongo_uri: str = "mongodb://localhost:27017"
    mongo_db: str = "deephire"

    redis_url: str = "redis://localhost:6379"

    minio_endpoint: str = "localhost:9000"
    minio_access_key: str = ""
    minio_secret_key: str = ""
    minio_bucket: str = "deephire-uploads"
    minio_secure: bool = False

    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "gpt-oss:20b-cloud"

    hh_client_id: str = ""
    hh_client_secret: str = ""
    hh_redirect_uri: str = ""
    hh_base_url: str = "https://api.hh.uz"
    hh_oauth_url: str = "https://hh.uz/oauth/authorize"
    hh_token_url: str = "https://hh.uz/oauth/token"
    hh_host: str = "hh.uz"

    frontend_url: str = "http://localhost:3001"

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

    # Ollama embedding model for Qdrant indexing and vacancy embedding
    embed_model: str = "nomic-embed-text"

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


settings = Settings()
