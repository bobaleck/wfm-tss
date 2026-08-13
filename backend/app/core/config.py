from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    SECRET_KEY: str = "dev-secret-change-in-production"
    FIRST_ADMIN_PASSWORD: str = "admin123"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480
    ALGORITHM: str = "HS256"

    WFM_DATABASE_URL: str = "sqlite:///./wfm.db"

    # Persistent analytics cache is a production-only feature. Even when this
    # flag is true, the service enables it only for PostgreSQL; local SQLite is
    # deliberately left untouched.
    ANALYTICS_CACHE_ENABLED: bool = True
    ANALYTICS_CACHE_TTL_SECONDS: int = 600
    ANALYTICS_CACHE_RETENTION_DAYS: int = 31
    ANALYTICS_CACHE_REFRESH_SCAN_SECONDS: int = 60

    # Employee synchronization scans a 90-day Naumen window, so it must be
    # considerably less frequent than analytics cache refreshes.
    EMPLOYEE_AUTO_SYNC_ENABLED: bool = True
    EMPLOYEE_AUTO_SYNC_MINUTES: int = 60

    NCC_DB_HOST: str = ""
    NCC_DB_NAME: str = "nccrep"
    NCC_DB_USER: str = "readonly"
    NCC_DB_PASSWORD: str = ""
    NCC_DB_PORT: int = 5432

    NCC_API_BASE_URL: str = ""
    NCC_API_USERNAME: str = ""
    FX_API_KEY: str = ""

    CORS_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173"

    @property
    def cors_origins_list(self) -> List[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
