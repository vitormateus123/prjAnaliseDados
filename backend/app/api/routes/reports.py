# backend/app/api/routes/reports.py
import base64
import binascii
import logging
import uuid as uuid_lib
from datetime import datetime
from fastapi import APIRouter, HTTPException
from postgrest.exceptions import APIError as PostgrestAPIError
from storage3.utils import StorageException
from app.services.supabase_service import get_client
from app.schemas.reports import (
    ReportIn, ReportOut, ReportFieldOut, CaptureOut, ReportItemOut,
    ReportSyncResult, SyncedCaptureRef,
)

router = APIRouter()
logger = logging.getLogger("reports")

# ─── permanencia da fonte de origem (imagem/audio) ────────────────────────
# Bucket privado ja provisionado na migration 0002. Guardamos aqui so o
# CAMINHO do arquivo (nunca uma URL assinada, que expira) — a URL exibida
# ao app e sempre gerada na hora da leitura, ver _resolve_capture_urls.
_CAPTURES_BUCKET = "captures"
MAX_CAPTURE_FILE_SIZE = 10 * 1024 * 1024  # 10 MB — mesmo limite do /extract/
_SIGNED_URL_TTL_SECONDS = 6 * 60 * 60  # 6h: mais que suficiente pra uma sessao de revisao

_MIME_EXTENSIONS = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "audio/m4a": "m4a",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
}


def _capture_extension(mime_type: str | None) -> str:
    return _MIME_EXTENSIONS.get(mime_type or "", "bin")


def _is_storage_path(file_url: str | None) -> bool:
    """Distingue um caminho de Storage (o que gravamos) de uma URL http
    completa (formato antigo/externo, se algum dia existir) — so a primeira
    precisa virar signed URL na leitura."""
    return bool(file_url) and not file_url.startswith("http")


def _upload_capture_file(report_id: str, capture_id: str, data_b64: str, mime_type: str | None) -> str | None:
    """Decodifica o base64 recebido do app e sobe pro Storage. Devolve o
    caminho salvo (pra gravar em captures.file_url) ou None se a captura
    veio invalida/grande demais — nesse caso a captura fica sem arquivo,
    mas o resto do relatorio continua sendo salvo normalmente (a foto/audio
    e um bonus de auditoria, nao o dado principal do relatorio)."""
    try:
        raw = base64.b64decode(data_b64, validate=True)
    except (binascii.Error, ValueError):
        logger.warning("Capture %s: base64 invalido, ignorando upload.", capture_id)
        return None
    if len(raw) > MAX_CAPTURE_FILE_SIZE:
        logger.warning("Capture %s: arquivo maior que %d bytes, ignorando upload.", capture_id, MAX_CAPTURE_FILE_SIZE)
        return None

    path = f"{report_id}/{capture_id}.{_capture_extension(mime_type)}"
    try:
        get_client().storage.from_(_CAPTURES_BUCKET).upload(
            path, raw,
            file_options={"content-type": mime_type or "application/octet-stream", "upsert": "true"},
        )
    except StorageException:
        logger.exception("Falha ao subir capture %s pro Storage.", capture_id)
        return None
    return path


def _resolve_capture_urls(rows: list[dict]) -> dict[str, str]:
    """Resolve, numa ÚNICA chamada ao Storage, a signed URL de todo caminho
    de capture presente nas rows (pode ser várias captures em vários
    relatórios — ver list_reports). Resolver uma por vez (uma chamada HTTP
    ao Supabase por capture) é o tipo de latência que faz o app estourar
    timeout numa tela de Histórico com vários relatórios."""
    paths = {
        c["file_url"]
        for row in rows
        for c in (row.get("captures") or [])
        if _is_storage_path(c.get("file_url"))
    }
    if not paths:
        return {}
    try:
        results = get_client().storage.from_(_CAPTURES_BUCKET).create_signed_urls(
            list(paths), _SIGNED_URL_TTL_SECONDS,
        )
    except StorageException:
        logger.exception("Falha ao gerar signed URLs em lote (%d caminhos).", len(paths))
        return {}
    return {
        r["path"]: url
        for r in results
        if r.get("path") and (url := r.get("signedURL") or r.get("signedUrl"))
    }

def _display_url(file_url: str | None, url_map: dict[str, str]) -> str | None:
    """file_url guardado pode ser um caminho de Storage (precisa virar
    signed URL via url_map) ou já uma URL http (nada a fazer)."""
    if not _is_storage_path(file_url):
        return file_url
    return url_map.get(file_url)


_REPORT_SELECT = (
    "*, form_templates(name), "
    "report_fields(*, form_fields(key,label,type)), "
    "report_items(*, report_item_fields(*, form_fields(key,label,type))), "
    "captures(*)"
)

# Formato esperado (ISO) primeiro; DD/MM/YYYY como fallback porque, apesar
# do prompt do Gemini pedir YYYY-MM-DD, às vezes ele devolve no formato
# brasileiro mesmo — e a coluna DATE do Postgres não aceita nenhum dos dois
# fora do padrão, rejeitando com "date/time field value out of range".
_DATE_FORMATS = ("%Y-%m-%d", "%d/%m/%Y")


def _is_valid_uuid(value: str) -> bool:
    try:
        uuid_lib.UUID(str(value))
        return True
    except (ValueError, AttributeError, TypeError):
        return False


def _normalize_date(value: str | None) -> str | None:
    """Aceita ISO ou DD/MM/YYYY e devolve sempre ISO. Se não reconhecer
    nenhum dos dois formatos, devolve None em vez de deixar a string bruta
    quebrar o INSERT inteiro — o valor original fica preservado em
    value_text (ver _field_value_to_columns) pra não se perder."""
    if not value:
        return None
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(value, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    logger.warning("Data em formato não reconhecido, gravando sem value_date: %r", value)
    return None


def _field_value_to_columns(field_value: dict) -> dict:
    """Converte o FieldValue (discriminated union JSON do app) para as
    colunas tipadas de report_fields."""
    field_type = field_value.get("type")
    value = field_value.get("value")

    columns: dict = {
        "value_text": None,
        "value_number": None,
        "value_boolean": None,
        "value_date": None,
        "value_json": None,
    }

    if field_type in ("text", "long_text", "select"):
        columns["value_text"] = value
    elif field_type in ("number", "decimal"):
        columns["value_number"] = value
    elif field_type == "boolean":
        columns["value_boolean"] = value
    elif field_type == "date":
        normalized = _normalize_date(value)
        columns["value_date"] = normalized
        if value and not normalized:
            columns["value_text"] = value  # preserva o valor bruto pra não perder a informação
    elif field_type == "multiselect":
        columns["value_json"] = value
    else:
        columns["value_json"] = field_value

    return columns


def _columns_to_field_value(row: dict, field_type: str) -> dict:
    """Reconstroi o FieldValue que o app espera a partir das colunas tipadas."""
    if field_type in ("text", "long_text", "select"):
        return {"type": field_type, "value": row.get("value_text")}
    if field_type in ("number", "decimal"):
        return {"type": field_type, "value": row.get("value_number")}
    if field_type == "boolean":
        return {"type": field_type, "value": row.get("value_boolean")}
    if field_type == "date":
        return {"type": field_type, "value": row.get("value_date")}
    if field_type == "multiselect":
        return {"type": field_type, "value": row.get("value_json") or []}
    return {"type": field_type, "value": row.get("value_json")}


def _row_to_report_out(row: dict, url_map: dict[str, str]) -> ReportOut:
    template = row.get("form_templates") or {}

    fields: list[ReportFieldOut] = []
    for rf in row.get("report_fields") or []:
        form_field = rf.get("form_fields") or {}
        # Para campos dinamicos (sem form_field_id), usa dynamic_type
        field_type = form_field.get("type") or rf.get("dynamic_type") or "text"
        fields.append(
            ReportFieldOut(
                form_field_id=rf.get("form_field_id"),
                key=form_field.get("key") or rf.get("dynamic_key") or rf.get("id", ""),
                label=form_field.get("label") or rf.get("dynamic_label") or "",
                field_value=_columns_to_field_value(rf, field_type),
                confidence=rf.get("confidence"),
                source=rf.get("source", "manual"),
                input_source=rf.get("input_source"),
                was_edited=rf.get("was_edited", False),
                dynamic_type=rf.get("dynamic_type"),
            )
        )

    items: list[ReportItemOut] = []
    for item in row.get("report_items") or []:
        item_fields: list[ReportFieldOut] = []
        for rf in item.get("report_item_fields") or []:
            form_field = rf.get("form_fields") or {}
            field_type = form_field.get("type") or "text"
            item_fields.append(ReportFieldOut(
                form_field_id=rf.get("form_field_id"),
                key=form_field.get("key") or rf.get("id", ""),
                label=form_field.get("label") or "",
                field_value=_columns_to_field_value(rf, field_type),
                confidence=rf.get("confidence"),
                source=rf.get("source", "manual"),
                input_source=rf.get("input_source"),
                was_edited=rf.get("was_edited", False),
            ))
        items.append(ReportItemOut(id=item["id"], fields=item_fields))

    captures = [
        CaptureOut(
            id=c["id"],
            type=c["type"],
            local_path=c.get("local_path"),
            file_url=_display_url(c.get("file_url"), url_map),
            mime_type=c.get("mime_type"),
            created_at=c["created_at"],
            text_content=c.get("text_content"),
            transcript=c.get("transcript"),
        )
        for c in row.get("captures") or []
    ]

    return ReportOut(
        id=row["id"],
        form_template_id=row.get("form_template_id"),
        form_template_name=template.get("name") or row.get("context_label"),
        context_label=row.get("context_label"),
        context_type=row.get("context_type"),
        status=row["status"],
        fields=fields,
        items=items,
        captures=captures,
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        synced_at=row.get("synced_at"),
    )


@router.post("/", response_model=ReportSyncResult)
def create_report(report: ReportIn):
    """Recebe um relatorio ja revisado no app e grava no banco.
    Idempotente: reenviar o mesmo relatorio faz upsert."""
    supabase = get_client()

    # Valida form_template_id apenas se estiver presente (modo guiado)
    if report.form_template_id is not None:
        if not _is_valid_uuid(report.form_template_id):
            raise HTTPException(
                status_code=422,
                detail=(
                    f'form_template_id "{report.form_template_id}" nao e um UUID valido. '
                    "Este relatorio foi criado com uma versao antiga do app."
                ),
            )
        template_check = (
            supabase.table("form_templates")
            .select("id")
            .eq("id", report.form_template_id)
            .execute()
        )
        if not template_check.data:
            raise HTTPException(
                status_code=404,
                detail=(
                    f"Formulario {report.form_template_id} nao encontrado no banco. "
                    "Ele pode ter sido removido — exclua este relatorio e crie um novo."
                ),
            )

    try:
        report_row = {
            "id": report.id,
            "local_id": report.id,
            "form_template_id": report.form_template_id,
            "context_label": report.context_label,
            "context_type": report.context_type,
            "status": "synced",
            "synced_at": report.synced_at,
        }
        report_resp = supabase.table("reports").upsert(report_row).execute()
        if not report_resp.data:
            raise HTTPException(status_code=500, detail="Falha ao gravar o relatorio.")

        if report.fields:
            guided_rows = []
            dynamic_rows = []
            for f in report.fields:
                row = {
                    "report_id": report.id,
                    "form_field_id": f.form_field_id,
                    "confidence": f.confidence,
                    "source": f.source,
                    "input_source": f.input_source,
                    "was_edited": f.was_edited,
                    "dynamic_key": f.key if not f.form_field_id else None,
                    "dynamic_label": f.label if not f.form_field_id else None,
                    "dynamic_type": f.dynamic_type,
                    **_field_value_to_columns(f.field_value),
                }
                (guided_rows if f.form_field_id else dynamic_rows).append(row)

            if guided_rows:
                # Não dá pra usar upsert com on_conflict aqui: a UNIQUE
                # (report_id, form_field_id) virou um índice PARCIAL na
                # migration 0005 (só se aplica quando form_field_id não é
                # nulo, pra permitir vários campos dinâmicos com NULL) — o
                # PostgREST não consegue casar ON CONFLICT com um índice
                # parcial. Mesmo padrão "apaga e reinsere" dos dynamic_rows
                # logo abaixo resolve e mantém o retry idempotente.
                supabase.table("report_fields").delete().eq("report_id", report.id).not_.is_(
                    "form_field_id", "null"
                ).execute()
                supabase.table("report_fields").insert(guided_rows).execute()
            if dynamic_rows:
                # Campos livres não possuem a chave única dos campos guiados.
                # Substituímos somente essa parte do relatório para manter a
                # sincronização idempotente sem duplicar dados a cada retry.
                supabase.table("report_fields").delete().eq("report_id", report.id).is_(
                    "form_field_id", "null"
                ).execute()
                supabase.table("report_fields").insert(dynamic_rows).execute()

        # Itens repetidos são parte do relatório, não apenas um detalhe da UI.
        # Recriar somente a coleção de itens deste relatório também propaga
        # remoções feitas na revisão e mantém retries idempotentes.
        supabase.table("report_items").delete().eq("report_id", report.id).execute()
        for position, item in enumerate(report.items):
            supabase.table("report_items").insert({
                "id": item.id,
                "report_id": report.id,
                "position": position,
            }).execute()
            item_field_rows = [
                {
                    "report_item_id": item.id,
                    "form_field_id": field.form_field_id,
                    "confidence": field.confidence,
                    "source": field.source,
                    "input_source": field.input_source,
                    "was_edited": field.was_edited,
                    **_field_value_to_columns(field.field_value),
                }
                for field in item.fields
            ]
            if item_field_rows:
                supabase.table("report_item_fields").insert(item_field_rows).execute()

        synced_captures: list[SyncedCaptureRef] = []
        if report.captures:
            capture_rows = []
            for c in report.captures:
                # 'data' so viaja nesta requisicao — se veio preenchido, faz
                # upload agora e troca file_url pelo caminho salvo no
                # Storage (permanencia real da imagem/audio). Se nao veio
                # (capture ja enviada num sync anterior), mantem o file_url
                # que o app mandou (o caminho ja salvo antes).
                file_url = c.file_url
                if c.data:
                    uploaded_path = _upload_capture_file(report.id, c.id, c.data, c.mime_type)
                    if uploaded_path:
                        file_url = uploaded_path
                capture_rows.append({
                    "id": c.id,
                    "report_id": report.id,
                    "type": c.type,
                    "local_path": c.local_path,
                    "file_url": file_url,
                    "mime_type": c.mime_type,
                    "text_content": c.text_content,
                    "transcript": c.transcript,
                })
                synced_captures.append(SyncedCaptureRef(id=c.id, file_url=file_url))
            supabase.table("captures").upsert(capture_rows, on_conflict="id").execute()
    except PostgrestAPIError as e:
        raise HTTPException(
            status_code=422,
            detail=f"Erro ao gravar no banco: {e.message}",
        )

    return ReportSyncResult(success=True, id=report.id, captures=synced_captures)


@router.get("/", response_model=list[ReportOut])
def list_reports(limit: int = 100):
    supabase = get_client()
    try:
        resp = (
            supabase.table("reports")
            .select(_REPORT_SELECT)
            .order("updated_at", desc=True)
            .limit(limit)
            .execute()
        )
    except PostgrestAPIError as e:
        raise HTTPException(
            status_code=422,
            detail=f"Erro ao buscar relatorios: {e.message}",
        )
    rows = resp.data or []
    url_map = _resolve_capture_urls(rows)
    return [_row_to_report_out(row, url_map) for row in rows]


@router.get("/{report_id}", response_model=ReportOut)
def get_report(report_id: str):
    supabase = get_client()
    try:
        resp = (
            supabase.table("reports")
            .select(_REPORT_SELECT)
            .eq("id", report_id)
            .execute()
        )
    except PostgrestAPIError as e:
        raise HTTPException(
            status_code=422,
            detail=f"Erro ao buscar relatorio: {e.message}",
        )
    rows = resp.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Relatorio nao encontrado.")
    url_map = _resolve_capture_urls(rows)
    return _row_to_report_out(rows[0], url_map)