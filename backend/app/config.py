"""
OmniBot SaaS — Application Configuration
Centralized settings via pydantic-settings (reads from .env)
"""
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", case_sensitive=True, extra="ignore")

    # ── App ──────────────────────────────────────
    APP_NAME: str = "OmniBot SaaS"
    APP_VERSION: str = "3.0.0"
    DEBUG: bool = False

    # ── Supabase ─────────────────────────────────
    SUPABASE_URL: str
    SUPABASE_ANON_KEY: str
    SUPABASE_SERVICE_ROLE_KEY: str

    # ── JWT ──────────────────────────────────────
    JWT_SECRET_KEY: str
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 1440  # 24 h

    # ── Gemini ───────────────────────────────────
    GEMINI_API_KEY: str
    GEMINI_MODEL: str = "gemini-2.5-flash"
    GEMINI_EMBEDDING_MODEL: str = "models/text-embedding-004"

    # ── Facebook / Meta ──────────────────────────
    FACEBOOK_APP_ID: str = ""
    FACEBOOK_APP_SECRET: str = ""
    FACEBOOK_VERIFY_TOKEN: str = "omnibot_verify_2026"

    # ── Sentry ───────────────────────────────────
    SENTRY_DSN: str = ""

    # ── Redis (Upstash) ──────────────────────────
    REDIS_URL: str = ""

    # ── SSLCommerz ───────────────────────────────
    SSLCOMMERZ_STORE_ID: str = ""
    SSLCOMMERZ_STORE_PASS: str = ""
    SSLCOMMERZ_IS_SANDBOX: bool = True

    # ── Encryption ───────────────────────────────
    AES_SECRET_KEY: str = "00000000000000000000000000000000"

    # ── SMTP (password reset emails) ─────────────
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASS: str = ""
    SMTP_FROM: str = "noreply@omnibot.app"

    # ── Cloudinary (product image hosting) ───────
    CLOUDINARY_CLOUD_NAME: str = ""
    CLOUDINARY_API_KEY:    str = ""
    CLOUDINARY_API_SECRET: str = ""

    # ── URLs ─────────────────────────────────────
    FRONTEND_URL: str = "http://localhost:3000"
    BACKEND_URL: str = "http://localhost:8000"

    # ── Derived helpers ──────────────────────────
    @property
    def sslcommerz_base_url(self) -> str:
        if self.SSLCOMMERZ_IS_SANDBOX:
            return "https://sandbox.sslcommerz.com"
        return "https://securepay.sslcommerz.com"


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
