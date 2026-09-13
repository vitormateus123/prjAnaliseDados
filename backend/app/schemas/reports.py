# backend/app/schemas/reports.py
# Espelha src/types/reports.ts — qualquer mudança lá precisa ser
# refletida aqui também.
from typing import Any
from pydantic import BaseModel


class ReportFieldIn(BaseModel):
    form_field_id: str
    key: str
    label: str
    # { type: FieldType, value: ... } — ver FieldValue em types/reports.ts.
    # Fica como dict solto de propósito: validar o discriminated union
    # inteiro em Pydantic duplicaria a lógica de fieldValue.ts sem
    # necessidade, já que quem decide o formato é sempre o app.
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


class ReportFieldOut(BaseModel):
    form_field_id: str
    key: str
    label: str
    field_value: dict[str, Any]
    confidence: float | None = None
    source: str
    was_edited: bool = False


class CaptureOut(BaseModel):
    id: str
    type: str
    local_path: str | None = None
    file_url: str | None = None
    mime_type: str | None = None
    created_at: str


class ReportOut(BaseModel):
    id: str
    form_template_id: str
    form_template_name: str
    status: str
    fields: list[ReportFieldOut] = []
    captures: list[CaptureOut] = []
    created_at: str
    updated_at: str
    synced_at: str | None = None


class ReportSyncResult(BaseModel):
    success: bool
    id: str
