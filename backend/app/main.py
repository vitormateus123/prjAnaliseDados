# backend/app/main.py
import logging
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from app.api.routes import templates, reports, extract
from app.core.config import settings
from app.security.auth import authenticate_request, clear_auth_context

logger = logging.getLogger("app")

app = FastAPI(title="Campo — Análise de Dados API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

@app.middleware("http")
async def require_authenticated_user(request: Request, call_next):
    # Health checks and CORS preflight remain public.
    if request.url.path == "/health" or request.method == "OPTIONS":
        return await call_next(request)

    try:
        await authenticate_request(request)

        # Template administration keeps the existing admin role; the role is
        # loaded from public.users on the server, never from the client.
        if request.url.path.startswith("/templates/") and request.method in {
            "POST", "PATCH", "DELETE"
        }:
            if request.state.auth_user.role != "admin":
                return JSONResponse(
                    status_code=403,
                    content={"detail": "Acesso não autorizado."},
                )

        response = await call_next(request)
        return response
    except HTTPException as exc:
        # Um HTTPException levantado AQUI DENTRO (ex: authenticate_request)
        # não passa pelo ExceptionMiddleware do FastAPI — esse middleware
        # fica mais para dentro na pilha, perto das rotas, então nunca vê
        # exceções que nascem no próprio middleware de auth. Um "raise"
        # simples sobe direto pro ServerErrorMiddleware, que não sabe
        # traduzir HTTPException e devolve 500 genérico pra qualquer coisa
        # — foi assim que um 403 (usuário sem perfil) virou 500 pro app.
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
    except Exception:
        # A resposta ao app continua genérica (sem expor SQL/paths/provider
        # data), mas o log do servidor precisa do traceback real — sem isso
        # todo 500 vira uma caixa-preta.
        logger.exception(
            "Erro nao tratado em %s %s", request.method, request.url.path
        )
        return JSONResponse(
            status_code=500,
            content={"detail": "Erro interno do servidor."},
        )
    finally:
        await clear_auth_context(request)

app.include_router(templates.router, prefix="/templates", tags=["templates"])
app.include_router(reports.router, prefix="/reports", tags=["reports"])
app.include_router(extract.router, prefix="/extract", tags=["extraction"])

@app.get("/health")
def health_check():
    return {"status": "ok"}