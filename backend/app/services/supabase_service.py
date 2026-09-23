# backend/app/services/supabase_service.py
from supabase import create_client, Client
from supabase.lib.client_options import ClientOptions
from app.core.config import settings


_admin_client: Client = create_client(
    settings.supabase_url,
    settings.supabase_service_key,
    options=ClientOptions(
        auto_refresh_token=False,
        persist_session=False,
    ),
)


def get_admin_client() -> Client:
    """Privileged client. Only authentication/profile lookups and other
    explicitly administrative operations may use this client."""
    return _admin_client


def get_client() -> Client:
    """Return a request-scoped client carrying the caller's JWT.

    The service key remains server-side, but the Authorization header is the
    user's access token, so Supabase evaluates RLS as that authenticated user.
    """
    from app.security.auth import get_access_token

    token = get_access_token()
    return create_client(
        settings.supabase_url,
        settings.supabase_service_key,
        options=ClientOptions(
            auto_refresh_token=False,
            persist_session=False,
            headers={"Authorization": f"Bearer {token}"},
        ),
    )