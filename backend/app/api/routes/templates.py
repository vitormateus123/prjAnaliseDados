# backend/app/api/routes/templates.py
from fastapi import APIRouter, HTTPException
from app.services.supabase_service import get_client
from app.schemas.forms import (
    FormTemplateOut, FormFieldOut,
    TemplateRenameIn, TemplateMergeIn, TemplateActionOut,
)

router = APIRouter()


def _load_fields(template_id: str) -> list[FormFieldOut]:
    supabase = get_client()
    fields_resp = (
        supabase.table("form_fields")
        .select("*")
        .eq("form_template_id", template_id)
        .order("position")
        .execute()
    )
    return [
        FormFieldOut(**{**f, "is_item_field": f.get("is_item_field", False)})
        for f in (fields_resp.data or [])
    ]


def _row_to_template_out(template: dict) -> FormTemplateOut:
    return FormTemplateOut(
        id=template["id"],
        name=template["name"],
        description=template.get("description"),
        version=template["version"],
        active=template["active"],
        has_items=template.get("has_items", False),
        source=template.get("source", "manual"),
        review_status=template.get("review_status", "approved"),
        fields=_load_fields(template["id"]),
    )


@router.get("/", response_model=list[FormTemplateOut])
def list_templates():
    """Lista os formulários ativos, cada um já com seus campos ordenados por 'position'.
    É isso que a FormSelectScreen do app consome no lugar do MOCK_FORM_TEMPLATES.
    Inclui templates com review_status='pending' de propósito: eles já são
    utilizáveis assim que a IA os propõe (ver /extract/auto), só não foram
    revisados por um humano ainda."""
    supabase = get_client()

    templates_resp = (
        supabase.table("form_templates")
        .select("*")
        .eq("active", True)
        .execute()
    )
    templates = templates_resp.data or []

    return [_row_to_template_out(template) for template in templates]


# ─── revisão de templates propostos pela IA (Fase 5) ───────────────────────
# Precisa vir ANTES de "/{template_id}" — senão o FastAPI casaria
# "/pending" com esse path param e nunca chegaria aqui.

@router.get("/pending", response_model=list[FormTemplateOut])
def list_pending_templates():
    """Templates com review_status='pending' — normalmente propostos pela IA
    em /extract/auto. É isso que a TemplatesRevisaoScreen do app lista para
    o usuário aprovar, renomear ou mesclar com um template já existente."""
    supabase = get_client()
    resp = (
        supabase.table("form_templates")
        .select("*")
        .eq("review_status", "pending")
        .order("created_at", desc=True)
        .execute()
    )
    return [_row_to_template_out(template) for template in (resp.data or [])]


@router.post("/{template_id}/approve", response_model=TemplateActionOut)
def approve_template(template_id: str):
    """Confirma que o template proposto pela IA está bom como está."""
    supabase = get_client()
    resp = (
        supabase.table("form_templates")
        .update({"review_status": "approved"})
        .eq("id", template_id)
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Formulário não encontrado.")
    return TemplateActionOut(success=True, id=template_id)


@router.patch("/{template_id}", response_model=FormTemplateOut)
def rename_template(template_id: str, payload: TemplateRenameIn):
    """Ajusta nome e/ou descrição de um template (tipicamente um pendente com
    um nome ruim proposto pela IA), sem mexer nos campos."""
    supabase = get_client()
    updates = {
        key: value
        for key, value in payload.model_dump(exclude_unset=True).items()
        if value is not None
    }
    if not updates:
        raise HTTPException(
            status_code=422, detail="Nada para atualizar — informe name e/ou description."
        )

    resp = supabase.table("form_templates").update(updates).eq("id", template_id).execute()
    if not resp.data:
        raise HTTPException(status_code=404, detail="Formulário não encontrado.")
    return _row_to_template_out(resp.data[0])


@router.post("/{template_id}/merge", response_model=TemplateActionOut)
def merge_template(template_id: str, payload: TemplateMergeIn):
    """Mescla um template pendente (geralmente um duplicado que a IA propôs
    para algo que já tinha template) em `target_template_id`:
    1. reaponta report_fields/report_item_fields que usavam campos de
       `template_id` para o campo equivalente (mesma `key`) em
       `target_template_id` — campos sem correspondência ficam sem migrar;
    2. reaponta os próprios reports para o template de destino;
    3. desativa o template de origem (não apaga, para não perder histórico
       de auditoria nem quebrar FKs de relatórios já sincronizados)."""
    supabase = get_client()
    target_id = payload.target_template_id
    if target_id == template_id:
        raise HTTPException(
            status_code=422, detail="Não é possível mesclar um template com ele mesmo."
        )

    target_check = (
        supabase.table("form_templates").select("id").eq("id", target_id).execute()
    )
    if not target_check.data:
        raise HTTPException(status_code=404, detail="Template de destino não encontrado.")

    source_fields = (
        supabase.table("form_fields").select("id,key").eq("form_template_id", template_id).execute()
    ).data or []
    target_fields = (
        supabase.table("form_fields").select("id,key").eq("form_template_id", target_id).execute()
    ).data or []
    target_id_by_key = {f["key"]: f["id"] for f in target_fields}

    migrated, skipped = 0, 0
    for sf in source_fields:
        target_field_id = target_id_by_key.get(sf["key"])
        if not target_field_id:
            skipped += 1
            continue
        supabase.table("report_fields").update(
            {"form_field_id": target_field_id}
        ).eq("form_field_id", sf["id"]).execute()
        supabase.table("report_item_fields").update(
            {"form_field_id": target_field_id}
        ).eq("form_field_id", sf["id"]).execute()
        migrated += 1

    supabase.table("reports").update(
        {"form_template_id": target_id}
    ).eq("form_template_id", template_id).execute()

    supabase.table("form_templates").update(
        {"active": False, "review_status": "approved"}
    ).eq("id", template_id).execute()

    message = f"Mesclado em {target_id}: {migrated} campo(s) migrado(s)"
    if skipped:
        message += f", {skipped} sem correspondência (não migrados)"
    return TemplateActionOut(success=True, id=target_id, message=message)


@router.get("/{template_id}", response_model=FormTemplateOut)
def get_template(template_id: str):
    """Um formulário específico — é isso que a CapturaScreen chama a partir
    do formTemplateId recebido por navegação (ou resolvido por /extract/auto)."""
    supabase = get_client()

    resp = (
        supabase.table("form_templates")
        .select("*")
        .eq("id", template_id)
        .execute()
    )
    rows = resp.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Formulário não encontrado.")

    return _row_to_template_out(rows[0])