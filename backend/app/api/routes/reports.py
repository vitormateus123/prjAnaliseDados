# backend/app/api/routes/reports.py
import uuid as uuid_lib
from fastapi import APIRouter, HTTPException
from postgrest.exceptions import APIError as PostgrestAPIError
from app.services.supabase_service import get_client
from app.schemas.reports import (
    ReportIn, ReportOut, ReportFieldOut, CaptureOut, ReportItemOut, ReportSyncResult,
)

router = APIRouter()

_REPORT_SELECT = (
    "*, form_templates(name), "
    "report_fields(*, form_fields(key,label,type)), "
    "report_items(*, report_item_fields(*, form_fields(key,label,type))), "
    "captures(*)"
)


def _is_valid_uuid(value: str) -> bool:
    try:
        uuid_lib.UUID(str(value))
        return True
    except (ValueError, AttributeError, TypeError):
        return False


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
        columns["value_date"] = value
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


def _row_to_report_out(row: dict) -> ReportOut:
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
            file_url=c.get("file_url"),
            mime_type=c.get("mime_type"),
            created_at=c["created_at"],
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

        if report.captures:
            capture_rows = [
                {
                    "id": c.id,
                    "report_id": report.id,
                    "type": c.type,
                    "local_path": c.local_path,
                    "file_url": c.file_url,
                    "mime_type": c.mime_type,
                }
                for c in report.captures
            ]
            supabase.table("captures").upsert(capture_rows, on_conflict="id").execute()
    except PostgrestAPIError as e:
        raise HTTPException(
            status_code=422,
            detail=f"Erro ao gravar no banco: {e.message}",
        )

    return ReportSyncResult(success=True, id=report.id)


@router.get("/", response_model=list[ReportOut])
def list_reports(limit: int = 100):
    supabase = get_client()
    resp = (
        supabase.table("reports")
        .select(_REPORT_SELECT)
        .order("updated_at", desc=True)
        .limit(limit)
        .execute()
    )
    return [_row_to_report_out(row) for row in (resp.data or [])]


@router.get("/{report_id}", response_model=ReportOut)
def get_report(report_id: str):
    supabase = get_client()
    resp = (
        supabase.table("reports")
        .select(_REPORT_SELECT)
        .eq("id", report_id)
        .execute()
    )
    rows = resp.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Relatorio nao encontrado.")
    return _row_to_report_out(rows[0])