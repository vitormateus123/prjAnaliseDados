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
    # Texto digitado (captures do tipo 'text') — persistido direto, sem
    # upload. Ver migration 0010.
    text_content: Optional[str] = None
    # Transcricao automatica do audio (captures do tipo 'voice'), gerada na
    # extracao e devolvida ao app junto do resultado — persistida direto,
    # igual text_content. Ver migration 0012.
    transcript: Optional[str] = None
    # Conteudo do arquivo (foto/audio) em base64 — so viaja nesta requisicao
    # (o app le o arquivo local antes de sincronizar); nunca fica salvo em
    # texto puro em lugar nenhum. Presente => o backend faz upload pro
    # Storage e troca file_url pelo caminho salvo la. Ausente numa capture
    # que ja tem file_url => ja foi enviada antes, nao reenviar.
    data: Optional[str] = None


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
    # URL assinada e temporaria, gerada na leitura a partir do caminho
    # guardado no Storage (ver _resolve_capture_url em reports.py) — o app
    # nunca deve persistir este valor como definitivo, so exibir.
    file_url: Optional[str] = None
    mime_type: Optional[str] = None
    created_at: str
    text_content: Optional[str] = None
    transcript: Optional[str] = None


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


class SyncedCaptureRef(BaseModel):
    """Referencia enxuta devolvida apos o sync, so pra o app marcar quais
    captures ja tem arquivo persistido no Storage e nao precisar reenviar
    o base64 delas numa proxima tentativa (retry apos erro de rede, etc.)."""
    id: str
    file_url: Optional[str] = None


class ReportSyncResult(BaseModel):
    success: bool
    id: str
    captures: list[SyncedCaptureRef] = []