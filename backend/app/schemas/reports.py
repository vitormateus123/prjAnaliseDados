# backend/app/schemas/reports.py
# Espelha src/types/reports.ts — campos opcionais refletem o novo modelo
# dinamico onde form_template_id deixa de ser obrigatorio.
from typing import Any, Optional
from pydantic import BaseModel


class ReportFieldIn(BaseModel):
    form_field_id: Optional[str] = None   # opcional — campos descobertos nao tem
    key: str
    label: str
    field_value: dict[str, Any]
    confidence: Optional[float] = None
    source: str
    input_source: Optional[str] = None    # 'image' | 'audio' | 'text' | 'combined' | 'manual'
    was_edited: bool = False
    # Campos dinamicos (descobertos pela IA, sem form_field_id)
    dynamic_type: Optional[str] = None


class CaptureIn(BaseModel):
    id: str
    type: str
    local_path: Optional[str] = None
    file_url: Optional[str] = None
    mime_type: Optional[str] = None
    created_at: str


class ReportItemIn(BaseModel):
    id: str
    fields: list[ReportFieldIn] = []


class ReportIn(BaseModel):
    id: str
    form_template_id: Optional[str] = None   # opcional no modo descoberta
    form_template_name: Optional[str] = None
    context_label: Optional[str] = None       # ex: "Nota Fiscal"
    context_type: Optional[str] = None        # ex: "nota_fiscal"
    # Finalidade escolhida pelo usuário antes de capturar (ver
    # EXTRACTION_PURPOSES em schemas/extraction.py) — só contexto/auditoria.
    extraction_purpose: Optional[str] = None
    extraction_custom_instruction: Optional[str] = None
    status: str
    fields: list[ReportFieldIn] = []
    items: list[ReportItemIn] = []
    captures: list[CaptureIn] = []
    created_at: str
    updated_at: str
    synced_at: Optional[str] = None


class ReportFieldOut(BaseModel):
    form_field_id: Optional[str] = None
    key: str
    label: str
    field_value: dict[str, Any]
    confidence: Optional[float] = None
    source: str
    input_source: Optional[str] = None
    was_edited: bool = False
    dynamic_type: Optional[str] = None


class CaptureOut(BaseModel):
    id: str
    type: str
    local_path: Optional[str] = None
    file_url: Optional[str] = None
    mime_type: Optional[str] = None
    created_at: str


class ReportItemOut(BaseModel):
    id: str
    fields: list[ReportFieldOut] = []


class ReportOut(BaseModel):
    id: str
    form_template_id: Optional[str] = None
    form_template_name: Optional[str] = None
    context_label: Optional[str] = None
    context_type: Optional[str] = None
    extraction_purpose: Optional[str] = None
    extraction_custom_instruction: Optional[str] = None
    status: str
    fields: list[ReportFieldOut] = []
    items: list[ReportItemOut] = []
    captures: list[CaptureOut] = []
    created_at: str
    updated_at: str
    synced_at: Optional[str] = None


class ReportSyncResult(BaseModel):
    success: bool
    id: str