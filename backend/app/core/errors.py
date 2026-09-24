# backend/app/core/errors.py
"""Formato único de erro da API: sempre {"detail": "<texto curto em pt-BR>"}.

Antes:
  - erros de validação (422) voltavam como lista de objetos do Pydantic, com
    o campo `input` ecoando o que o cliente mandou (inclusive payloads
    base64 gigantes) — e o app (apiClient.parseError) só exibe `detail` string;
  - erros do banco vazavam e.message do PostgREST (nomes de tabela/constraint).
Agora o detalhe técnico vai só para o log do servidor.
"""
import asyncio
import logging

import httpx
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from postgrest.exceptions import APIError as PostgrestAPIError

from app.core.media import MediaError

logger = logging.getLogger("errors")

# apiClient.parseError só mostra `detail` com menos de 180 caracteres
_MAX_DETAIL = 170


def _validation_detail(exc: RequestValidationError) -> str:
    parts: list[str] = []
    for err in exc.errors()[:3]:
        loc = ".".join(str(p) for p in err.get("loc", ()) if p not in ("body", "query", "path"))
        msg = str(err.get("msg", "inválido")).removeprefix("Value error, ")
        parts.append(f"{loc}: {msg}" if loc else msg)
    detail = "Dados inválidos — " + "; ".join(parts)
    return detail if len(detail) <= _MAX_DETAIL else detail[:_MAX_DETAIL - 1] + "…"


def _postgrest_response(exc: PostgrestAPIError) -> JSONResponse:
    code = str(getattr(exc, "code", "") or "")
    if code == "23505":
        status, detail = 409, "Já existe um registro com esses dados."
    elif code == "23503":
        status, detail = 409, "Referência inválida: o registro relacionado não existe."
    elif code == "42501":
        status, detail = 403, "Acesso não autorizado."
    elif code.startswith("PGRST30"):  # PGRST301/303: JWT inválido/expirado
        status, detail = 401, "Sessão inválida ou expirada."
    elif code.startswith("22") or code in {"23502", "23514"}:
        status, detail = 422, "Algum dado está em formato inválido."
    else:
        status, detail = 500, "Erro interno do servidor."
    return JSONResponse(status_code=status, content={"detail": detail})


def public_ai_error(exc: Exception) -> tuple[str, bool]:
    """(mensagem segura, retryable) para devolver ao app.

    Antes o app recebia str(exc) — que em falhas de SDK/rede inclui URLs,
    trechos de resposta do provedor e até parte da configuração. O detalhe
    real vai para o log (quem chama já usa logger.exception)."""
    if isinstance(exc, MediaError):
        return str(exc), False
    if isinstance(exc, (asyncio.TimeoutError, httpx.TimeoutException)):
        return "A análise demorou mais que o esperado. Tente novamente.", True
    status = getattr(exc, "code", None) or getattr(exc, "status_code", None)
    if status in (429, 500, 502, 503, 504):
        return "O serviço de IA está sobrecarregado no momento. Tente novamente em instantes.", True
    if status == 400:
        return "A IA não conseguiu processar este conteúdo.", False
    return "Não foi possível processar a solicitação. Tente novamente.", True


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(RequestValidationError)
    async def _on_validation_error(request: Request, exc: RequestValidationError):
        logger.info("422 em %s %s: %s", request.method, request.url.path,
                    [(e.get("loc"), e.get("type")) for e in exc.errors()[:5]])
        return JSONResponse(status_code=422, content={"detail": _validation_detail(exc)})

    @app.exception_handler(PostgrestAPIError)
    async def _on_postgrest_error(request: Request, exc: PostgrestAPIError):
        # Detalhe real só no log (nunca no corpo da resposta).
        logger.error("PostgREST %s em %s %s: %s", getattr(exc, "code", "?"),
                     request.method, request.url.path, getattr(exc, "message", exc))
        return _postgrest_response(exc)