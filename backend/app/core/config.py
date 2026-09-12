# backend/app/core/config.py
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    gemini_api_key: str
    groq_api_key: str
    supabase_url: str
    supabase_service_key: str          # service role — NUNCA expor no app
    allowed_origins: list[str] = ["*"] # restrinja em produção

    class Config:
        env_file = ".env"

settings = Settings()