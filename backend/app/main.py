# backend/app/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.routes import templates, reports, extract
from app.core.config import settings

app = FastAPI(title="Campo — Análise de Dados API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(templates.router, prefix="/templates", tags=["templates"])
app.include_router(reports.router, prefix="/reports", tags=["reports"])
app.include_router(extract.router, prefix="/extract", tags=["extraction"])

@app.get("/health")
def health_check():
    return {"status": "ok"}