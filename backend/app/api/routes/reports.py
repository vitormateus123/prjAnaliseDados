# backend/app/api/routes/reports.py
import uuid as uuid_lib
from fastapi import APIRouter, HTTPException
from postgrest.exceptions import APIError as PostgrestAPIError
from app.services.supabase_service import get_client
from app.schemas.reports import ReportIn, ReportOut, ReportFieldOut, CaptureOut, ReportSyncResult

router = APIRouter()

# Todo GET que devolve um relatório completo busca esses relacionamentos
# de uma vez (embedding do PostgREST), evitando N+1 queries.
_REPORT_SELECT = (
    "*, form_templates(name), "
    "report_fields(*, form_fields(key,label,type)), "
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
    colunas tipadas de report_fields. Espelha src/utils/fieldValue.ts —
    apenas UMA coluna value_* deve vir preenchida por linha."""
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
        # tipo inesperado — guarda o objeto inteiro em vez de descartar o dado
        columns["value_json"] = field_value

    return columns


def _columns_to_field_value(row: dict, field_type: str) -> dict:
    """O inverso de _field_value_to_columns — reconstrói o FieldValue que o
    app espera a partir das colunas tipadas vindas do Supabase."""
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
        field_type = form_field.get("type", "text")
        fields.append(
            ReportFieldOut(
                form_field_id=rf["form_field_id"],
                key=form_field.get("key", ""),
                label=form_field.get("label", ""),
                field_value=_columns_to_field_value(rf, field_type),
                confidence=rf.get("confidence"),
                source=rf.get("source", "manual"),
                was_edited=rf.get("was_edited", False),
            )
        )

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
        form_template_id=row["form_template_id"],
        form_template_name=template.get("name", ""),
        status=row["status"],
        fields=fields,
        captures=captures,
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        synced_at=row.get("synced_at"),
    )


@router.post("/", response_model=ReportSyncResult)
def create_report(report: ReportIn):
    """Recebe um relatório já revisado no app e grava em 'reports' +
    'report_fields' + 'captures'. É o endpoint que SyncService.ts chama
    quando o dispositivo volta a ficar online.

    Idempotente: reenviar o mesmo relatório (mesmo id) faz upsert em vez
    de duplicar — importante porque o app pode reter uma retentativa de
    sync sem ter certeza se a anterior chegou a completar."""
    supabase = get_client()

    # Relatórios criados com versões antigas do app (antes dos formulários
    # dinâmicos) podem ter um form_template_id tipo "form-analise-documento"
    # em vez de um UUID real — isso nunca vai sincronizar, então avisamos
    # com uma mensagem clara em vez de deixar o Postgres estourar um 500 cru.
    if not _is_valid_uuid(report.form_template_id):
        raise HTTPException(
            status_code=422,
            detail=(
                f"form_template_id \"{report.form_template_id}\" não é um UUID válido. "
                "Este relatório foi criado com uma versão antiga do app (antes dos "
                "formulários dinâmicos) e não pode ser sincronizado — exclua-o e "
                "crie um novo escolhendo um formulário atual."
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
                f"Formulário {report.form_template_id} não encontrado no banco. "
                "Ele pode ter sido removido — exclua este relatório e crie um novo."
            ),
        )

    try:
        report_row = {
            "id": report.id,
            "local_id": report.id,
            "form_template_id": report.form_template_id,
            # Se chegou até aqui é porque o SyncService só chama este endpoint
            # com o dispositivo online — o status final no banco é sempre 'synced'.
            "status": "synced",
            "synced_at": report.synced_at,
        }
        report_resp = supabase.table("reports").upsert(report_row).execute()
        if not report_resp.data:
            raise HTTPException(status_code=500, detail="Falha ao gravar o relatório.")

        if report.fields:
            field_rows = [
                {
                    "report_id": report.id,
                    "form_field_id": f.form_field_id,
                    "confidence": f.confidence,
                    "source": f.source,
                    "was_edited": f.was_edited,
                    **_field_value_to_columns(f.field_value),
                }
                for f in report.fields
            ]
            supabase.table("report_fields").upsert(
                field_rows, on_conflict="report_id,form_field_id"
            ).execute()

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
            # Upload do arquivo em si (foto/áudio) para o Supabase Storage
            # ainda não está implementado — por enquanto só guardamos
            # local_path. file_url fica NULL até essa próxima etapa existir.
            supabase.table("captures").upsert(capture_rows, on_conflict="id").execute()
    except PostgrestAPIError as e:
        raise HTTPException(
            status_code=422,
            detail=f"Erro ao gravar no banco: {e.message}",
        )

    return ReportSyncResult(success=True, id=report.id)


@router.get("/", response_model=list[ReportOut])
def list_reports(limit: int = 100):
    """Lista os relatórios que já existem no Supabase — é isso que o
    Histórico do app deve mesclar com os rascunhos locais, para mostrar o
    que está no banco de verdade e não só o que está no dispositivo."""
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
        raise HTTPException(status_code=404, detail="Relatório não encontrado.")
    return _row_to_report_out(rows[0])
