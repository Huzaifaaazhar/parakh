"""Application settings, loaded from environment variables / .env."""

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../.env"), extra="ignore")

    # --- App ---
    app_name: str = "Parakh"
    environment: str = "development"
    debug: bool = False
    log_level: str = "INFO"
    api_prefix: str = "/api"
    cors_origins: str = "http://localhost:4200,http://localhost:8080"

    # --- Database / cache ---
    database_url: str = "postgresql+psycopg://parakh:parakh@localhost:5432/parakh"
    redis_url: str = "redis://localhost:6379/0"
    cache_ttl_seconds: int = 600
    cache_enabled: bool = True

    # --- Celery ---
    celery_broker_url: str | None = None
    celery_result_backend: str | None = None
    scrape_interval_hours: int = Field(default=6, ge=1, le=24)

    # --- Scraping ---
    scraper_config_path: str = str(BASE_DIR / "app" / "scrapers" / "restaurants.yaml")
    scraper_fetcher: str = "scrapling"  # scrapling | httpx | stealth | dynamic
    scraper_max_pages: int = 20
    scraper_page_size: int = 250
    scraper_request_delay: float = 1.0
    scraper_timeout: int = 30
    browser_executable: str | None = None  # Chromium path for menu capture (Playwright default if unset)

    # --- Google Places (optional; restaurant ratings, address, Google reviews) ---
    google_maps_api_key: str | None = None
    google_places_language: str = "en"
    google_places_region: str = "pk"

    # --- Reviews / media / ads ---
    media_dir: str = str(BASE_DIR / "data" / "media")
    media_url_prefix: str = "/media"
    max_upload_mb: int = 40

    # --- Embeddings / vector store ---
    embedding_backend: str = "sentence-transformers"  # sentence-transformers | hash
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    vector_backend: str = "chroma"  # chroma | leann | memory
    chroma_path: str = str(BASE_DIR / "data" / "chroma")
    chroma_host: str | None = None
    chroma_port: int = 8000
    leann_index_path: str = str(BASE_DIR / "data" / "leann" / "products.leann")

    # --- LLM (optional; the app falls back to rules when unset) ---
    llm_provider: str = "none"  # none | groq | openrouter | ollama | auto
    llm_fallback_providers: str = ""  # comma separated, tried in order
    llm_model: str | None = None
    llm_fast_model: str | None = None
    llm_timeout: int = 30
    llm_temperature: float = 0.3
    groq_api_key: str | None = None
    groq_base_url: str = "https://api.groq.com/openai/v1"
    openrouter_api_key: str | None = None
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    ollama_base_url: str = "http://localhost:11434/v1"
    llmfit_url: str | None = None  # e.g. http://llmfit:8787 (llmfit serve)

    # --- Memory ---
    memory_backend: str = "db"  # db | mempalace
    memory_history_turns: int = 6
    mempalace_palace_path: str = str(BASE_DIR / "data" / "mempalace")

    # --- Auth ---
    secret_key: str = "change-me-in-production"
    access_token_expire_minutes: int = 60 * 24 * 7
    jwt_algorithm: str = "HS256"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def broker_url(self) -> str:
        return self.celery_broker_url or self.redis_url

    @property
    def result_backend(self) -> str:
        return self.celery_result_backend or self.redis_url


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
