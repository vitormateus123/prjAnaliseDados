# backend/app/api/routes/reports.py
# Stub inicial — recebe os relatórios enviados pelo SyncService.ts quando o
# dispositivo volta a ficar online. Por enquanto apenas valida o payload e
# confirma o recebimento; a persistência real no Supabase (reports +
# report_fields) fica para uma fase futura.
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


class ReportFieldIn(BaseModel):
    form_field_id: str
    key: str
    label: str
    field_value: dict[str, Any]
    confidence: float | None = None
    source: str
    was_edited: bool = False


class CaptureIn(BaseModel):
    id: str
    type: str
    local_path: str | None = None
    file_url: str | None = None
    mime_type: str | None = None
    created_at: str


class ReportIn(BaseModel):
    id: str
    form_template_id: str
    form_template_name: str
    status: str
    fields: list[ReportFieldIn] = []
    captures: list[CaptureIn] = []
    created_at: str
    updated_at: str
    synced_at: str | None = None


@router.post("/")
def create_report(report: ReportIn):
    # TODO (fase futura): persistir em Supabase (reports, report_fields, captures)
    return {"success": True, "id": report.id}