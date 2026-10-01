from __future__ import annotations

import logging
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Optional

from fastapi import HTTPException, Request
from supabase import Client

from app.services.supabase_service import get_admin_client

logger = logging.getLogger("auth")


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
        auth_response = admin.auth.get_user(token)
        auth_user = getattr(auth_response, "user", None)
        if auth_user is None:
            raise ValueError("invalid auth user")

        profile = _load_profile(admin, str(auth_user.id))
        if not profile:
            profile = _provision_default_profile(admin, auth_user, token)
        if not profile:
            logger.warning(
                "Perfil ausente em public.users; seguindo com field_agent temporário para %s",
                auth_user.id,
            )
            profile = _profile_from_auth_user(auth_user)

        if profile.get("role") not in {"admin", "field_agent", "viewer"}:
            raise HTTPException(status_code=403, detail="Perfil não autorizado.")

        user = AuthenticatedUser(
            id=str(auth_user.id),
            email=getattr(auth_user, "email", None),
            name=profile.get("name") or "",
            role=profile["role"],
            organization_id=profile.get("organization_id"),
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception("Falha ao autenticar requisição")
        raise HTTPException(status_code=401, detail="Sessão inválida ou expirada.")

    user_token, token_token = set_auth_context(user, token)
    request.state.auth_user = user
    request.state.auth_token = token
    request.state._auth_context_tokens = (user_token, token_token)


def _display_name(auth_user) -> str:
    email = getattr(auth_user, "email", None)
    metadata = getattr(auth_user, "user_metadata", None) or {}
    if not isinstance(metadata, dict):
        metadata = {}
    name = (
        metadata.get("name")
        or metadata.get("full_name")
        or (email.split("@", 1)[0] if email else "Usuário")
    )
    return str(name)[:120]


def _profile_from_auth_user(auth_user) -> dict:
    return {
        "id": str(auth_user.id),
        "name": _display_name(auth_user),
        "role": "field_agent",
        "organization_id": None,
    }


def _first_row(response) -> dict | None:
    if response is None:
        return None
    data = getattr(response, "data", None)
    if isinstance(data, list):
        return data[0] if data else None
    if isinstance(data, dict):
        return data
    return None


def _load_profile(admin: Client, user_id: str) -> dict | None:
    try:
        response = (
            admin.table("users")
            .select("id,name,role,organization_id")
            .eq("id", user_id)
            .limit(1)
            .execute()
        )
    except Exception:
        logger.exception("Falha ao ler public.users para %s", user_id)
        return None
    return _first_row(response)


def _provision_default_profile(admin: Client, auth_user, token: str) -> dict | None:
    user_id = str(auth_user.id)
    payload = {
        "id": user_id,
        "name": _display_name(auth_user),
        "role": "field_agent",
    }

    try:
        from app.core.config import settings
        from supabase import ClientOptions, create_client

        user_db = create_client(
            settings.supabase_url,
            settings.supabase_service_key,
            options=ClientOptions(
                auto_refresh_token=False,
                persist_session=False,
                headers={"Authorization": f"Bearer {token}"},
            ),
        )
        rpc = user_db.rpc("ensure_own_profile").execute()
        profile = _first_row(rpc)
        if profile:
            logger.info("Perfil garantido via ensure_own_profile para %s", user_id)
            return profile
    except Exception:
        logger.exception("ensure_own_profile indisponível para %s", user_id)

    try:
        created = admin.table("users").upsert(payload, on_conflict="id").execute()
        profile = _first_row(created)
        if profile:
            logger.info("Perfil padrão criado para %s", user_id)
            return profile
    except Exception:
        logger.exception("Falha ao upsert public.users para %s", user_id)

    return _load_profile(admin, user_id)


async def clear_auth_context(request: Request) -> None:
    tokens = getattr(request.state, "_auth_context_tokens", None)
    if tokens:
        reset_auth_context(*tokens)


def require_role(*roles: str) -> AuthenticatedUser:
    user = get_current_user()
    if user.role not in roles:
        raise HTTPException(status_code=403, detail="Acesso não autorizado.")
    return user