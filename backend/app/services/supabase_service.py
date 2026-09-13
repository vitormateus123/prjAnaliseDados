# backend/app/services/supabase_service.py
from supabase import create_client, Client
from app.core.config import settings

# Client com a service_role key — só existe aqui no backend, nunca no app.
# Ela ignora o RLS, então qualquer checagem de permissão/organização
# precisa ser feita explicitamente nas rotas que usam este client.
_client: Client = create_client(settings.supabase_url, settings.supabase_service_key)


def get_client() -> Client:
    return _client
