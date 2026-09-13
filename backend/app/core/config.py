# backend/app/core/config.py
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    gemini_api_key: str
    groq_api_key: str
    supabase_url: str
    supabase_service_key: str    # service role — NUNCA expor no app

    # String simples e separada por vírgula no .env, ex:
    # ALLOWED_ORIGINS=http://localhost:19006,exp://192.168.1.6:8081
    # (mantido como str, e não list[str], porque o pydantic-settings tenta
    # decodificar campos list como JSON e quebraria com vírgulas soltas)
    allowed_origins: str = "*"

    @property
    def allowed_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]

    class Config:
        env_file = ".env"

settings = Settings()