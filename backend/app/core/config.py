# backend/app/core/config.py
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    gemini_api_key: str
    groq_api_key: str
    supabase_url: str
    supabase_service_key: str    # service role — NUNCA expor no app

    gemini_model: str = "gemini-3.5-flash-lite"

    # Produção deve declarar uma lista explícita. O wildcard só é permitido
    # fora de produção para facilitar o desenvolvimento local.
    allowed_origins: str = "http://localhost:8081,http://localhost:19006"
    app_env: str = "development"

    @model_validator(mode="after")
    def validate_production_security(self):
        if self.app_env.lower() in {"production", "prod"} and not self.supabase_url.startswith("https://"):
            raise ValueError("SUPABASE_URL deve usar HTTPS em produção.")
        return self

    @property
    def allowed_origins_list(self) -> list[str]:
        origins = [
            origin.strip()
            for origin in self.allowed_origins.split(",")
            if origin.strip()
        ]
        if self.app_env.lower() in {"production", "prod"} and (
            not origins or "*" in origins
        ):
            raise RuntimeError(
                "ALLOWED_ORIGINS deve ser explícito em produção; wildcard não é permitido."
            )
        return origins


settings = Settings()