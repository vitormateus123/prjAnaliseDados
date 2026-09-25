from __future__ import annotations

from contextvars import ContextVar
from dataclasses import dataclass
from typing import Optional

from fastapi import HTTPException, Request
from supabase import Client
import requests

from app.services.supabase_service import get_admin_client
from app.core.config import settings


@dataclass(frozen=True)
class AuthenticatedUser:
    id: str
    email: Optional[str]
    name: str
    role: str
    organization_id: Optional[str]


_current_user: ContextVar[AuthenticatedUser | None] = ContextVar(
    "current_authenticated_user", default=None
)
_current_token: ContextVar[str | None] = ContextVar(
    "current_access_token", default=None
)


def set_auth_context(user: AuthenticatedUser, token: str):
    user_token = _current_user.set(user)
    token_token = _current_token.set(token)
    return user_token, token_token


def reset_auth_context(user_token, token_token) -> None:
    _current_user.reset(user_token)
    _current_token.reset(token_token)


def get_current_user() -> AuthenticatedUser:
    user = _current_user.get()
    if user is None:
        raise HTTPException(status_code=401, detail="Não autenticado.")
    return user


def get_access_token() -> str:
    token = _current_token.get()
    if not token:
        raise HTTPException(status_code=401, detail="Não autenticado.")
    return token


def _bearer_token(request: Request) -> str | None:
    value = request.headers.get("authorization", "")
    scheme, _, token = value.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return None
    return token.strip()


async def authenticate_request(request: Request) -> None:
    """Validate the Supabase access token and load the server-side profile.

    The public.users row is the authority for role and organization; no
    frontend-supplied identity or role is trusted.
    """
    token = _bearer_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Não autenticado.")

    admin: Client = get_admin_client()
    try:
        # Validate the access token against Supabase Auth directly.  Using
        # the admin client's auth.get_user(token) can be affected by the
        # client's own auth headers/session state and was causing valid mobile
        # sessions to be rejected with 401 in production.
        response = requests.get(
            f"{settings.supabase_url.rstrip('/')}/auth/v1/user",
            headers={
                "apikey": settings.supabase_service_key,
                "Authorization": f"Bearer {token}",
            },
            timeout=10,
        )
        if response.status_code != 200:
            raise ValueError(f"Supabase Auth rejected token ({response.status_code})")

        auth_user = response.json()
        if not auth_user.get("id"):
            raise ValueError("invalid auth user")

        profile_response = (
            admin.table("users")
            .select("id,name,role,organization_id")
            .eq("id", str(auth_user["id"]))
            .maybe_single()
            .execute()
        )
        # Nesta versao do postgrest-py, maybe_single().execute() retorna
        # None (nao um objeto com .data = None) quando 0 linhas batem —
        # acontece quando o usuario autenticado no Supabase Auth ainda nao
        # tem uma linha correspondente em public.users.
        profile = profile_response.data if profile_response is not None else None
        if not profile:
            raise HTTPException(status_code=403, detail="Usuário sem perfil autorizado.")
        if profile.get("role") not in {"admin", "field_agent", "viewer"}:
            raise HTTPException(status_code=403, detail="Perfil não autorizado.")

        user = AuthenticatedUser(
            id=str(auth_user["id"]),
            email=auth_user.get("email"),
            name=profile.get("name") or "",
            role=profile["role"],
            organization_id=profile.get("organization_id"),
        )
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Sessão inválida ou expirada.")

    user_token, token_token = set_auth_context(user, token)
    request.state.auth_user = user
    request.state.auth_token = token
    request.state._auth_context_tokens = (user_token, token_token)


async def clear_auth_context(request: Request) -> None:
    tokens = getattr(request.state, "_auth_context_tokens", None)
    if tokens:
        reset_auth_context(*tokens)


def require_role(*roles: str) -> AuthenticatedUser:
    user = get_current_user()
    if user.role not in roles:
        raise HTTPException(status_code=403, detail="Acesso não autorizado.")
    return user