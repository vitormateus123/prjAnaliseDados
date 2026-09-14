# backend/app/core/config.py
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env")

    gemini_api_key: str
    groq_api_key: str
    supabase_url: str
    supabase_service_key: str    # service role — NUNCA expor no app

    # Nome do modelo Gemini. Fica aqui (e não hardcoded no service) porque o
    # Google aposenta modelos periodicamente: o gemini-2.0-flash-lite foi
    # desligado em 01/06/2026 e passou a retornar 404. Sobrescreva com
    # GEMINI_MODEL no .env quando precisar trocar.
    gemini_model: str = "gemini-3.5-flash-lite"

    # String simples e separada por vírgula no .env, ex:
    # ALLOWED_ORIGINS=http://localhost:19006,exp://192.168.1.6:8081
    # (mantido como str, e não list[str], porque o pydantic-settings tenta
    # decodificar campos list como JSON e quebraria com vírgulas soltas)
    allowed_origins: str = "*"

    @property
    def allowed_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]

settings = Settings()