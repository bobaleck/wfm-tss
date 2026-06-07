from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    SECRET_KEY: str = "dev-secret-change-in-production"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480
    ALGORITHM: str = "HS256"

    WFM_DATABASE_URL: str = "sqlite:///./wfm.db"

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
