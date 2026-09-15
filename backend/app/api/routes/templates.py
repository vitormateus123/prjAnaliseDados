# backend/app/api/routes/templates.py
from fastapi import APIRouter, HTTPException
from app.services.supabase_service import get_client
from app.schemas.forms import (
    FormTemplateOut, FormFieldOut,
    TemplateRenameIn, TemplateMergeIn, TemplateActionOut,
    FormFieldIn, FormFieldUpdateIn, FormTemplateCreateIn,
)

router = APIRouter()

FIELD_TYPES = {
    "text", "long_text", "number", "decimal",
    "date", "boolean", "select", "multiselect",
}


def _check_field_type(type_: str) -> None:
    if type_ not in FIELD_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"Tipo de campo inválido: '{type_}'. Use um de {sorted(FIELD_TYPES)}.",
        )


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


# ─── gerenciamento manual de formulários/campos ────────────────────────────
# Precisa vir ANTES de "/{template_id}" pelo mesmo motivo de "/pending" logo
# abaixo. Existe pra você não depender da IA propor um template em
# /extract/auto antes de conseguir ter um campo novo — cria/edita direto.

@router.post("/", response_model=FormTemplateOut, status_code=201)
def create_template(payload: FormTemplateCreateIn):
    """Cria um formulário do zero, já 'manual'/'approved' — não passa pela
    fila de revisão da IA."""
    supabase = get_client()

    for f in payload.fields:
        _check_field_type(f.type)

    template_resp = (
        supabase.table("form_templates")
        .insert({
            "name": payload.name,
            "description": payload.description,
            "version": 1,
            "active": True,
            "has_items": payload.has_items,
            "source": "manual",
            "review_status": "approved",
        })
        .execute()
    )
    if not template_resp.data:
        raise HTTPException(status_code=500, detail="Falha ao criar o formulário.")
    template_row = template_resp.data[0]

    if payload.fields:
        field_rows = [
            {
                "form_template_id": template_row["id"],
                "key": f.key,
                "label": f.label,
                "type": f.type,
                "required": f.required,
                "position": f.position if f.position is not None else i,
                "description": f.description,
                "extraction_hint": f.extraction_hint,
                "options": f.options,
                "validation_rules": (
                    f.validation_rules.model_dump(exclude_none=True) if f.validation_rules else None
                ),
                "is_item_field": f.is_item_field,
            }
            for i, f in enumerate(payload.fields)
        ]
        fields_resp = supabase.table("form_fields").insert(field_rows).execute()
        if not fields_resp.data:
            raise HTTPException(
                status_code=409,
                detail="Formulário criado, mas falhou ao gravar os campos — keys repetidas?",
            )

    return _row_to_template_out(template_row)


@router.post("/{template_id}/fields", response_model=FormFieldOut, status_code=201)
def add_field(template_id: str, payload: FormFieldIn):
    """Adiciona um campo a um formulário já existente, sem apagar os que já
    tinha nem depender de a IA propor nada."""
    supabase = get_client()
    _check_field_type(payload.type)

    template_check = supabase.table("form_templates").select("id").eq("id", template_id).execute()
    if not template_check.data:
        raise HTTPException(status_code=404, detail="Formulário não encontrado.")

    if payload.position is None:
        last = (
            supabase.table("form_fields")
            .select("position")
            .eq("form_template_id", template_id)
            .order("position", desc=True)
            .limit(1)
            .execute()
        )
        next_position = (last.data[0]["position"] + 1) if last.data else 0
    else:
        next_position = payload.position

    resp = (
        supabase.table("form_fields")
        .insert({
            "form_template_id": template_id,
            "key": payload.key,
            "label": payload.label,
            "type": payload.type,
            "required": payload.required,
            "position": next_position,
            "description": payload.description,
            "extraction_hint": payload.extraction_hint,
            "options": payload.options,
            "validation_rules": (
                payload.validation_rules.model_dump(exclude_none=True) if payload.validation_rules else None
            ),
            "is_item_field": payload.is_item_field,
        })
        .execute()
    )
    if not resp.data:
        # UNIQUE(form_template_id, key) é a causa mais provável de falha aqui.
        raise HTTPException(
            status_code=409,
            detail=f"Não foi possível criar o campo — já existe uma key '{payload.key}' nesse formulário?",
        )
    row = resp.data[0]
    return FormFieldOut(**{**row, "is_item_field": row.get("is_item_field", False)})


@router.patch("/{template_id}/fields/{field_id}", response_model=FormFieldOut)
def update_field(template_id: str, field_id: str, payload: FormFieldUpdateIn):
    """Edita um campo existente. Não mexe em report_fields/report_item_fields
    já preenchidos — a FK é pelo id do campo, que não muda."""
    supabase = get_client()
    if payload.type is not None:
        _check_field_type(payload.type)

    updates = {
        key: (value.model_dump(exclude_none=True) if key == "validation_rules" and value else value)
        for key, value in payload.model_dump(exclude_unset=True).items()
    }
    if not updates:
        raise HTTPException(status_code=422, detail="Nada para atualizar.")

    resp = (
        supabase.table("form_fields")
        .update(updates)
        .eq("id", field_id)
        .eq("form_template_id", template_id)
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Campo não encontrado nesse formulário.")
    row = resp.data[0]
    return FormFieldOut(**{**row, "is_item_field": row.get("is_item_field", False)})


@router.delete("/{template_id}/fields/{field_id}", response_model=TemplateActionOut)
def delete_field(template_id: str, field_id: str):
    """Remove um campo — só quando nenhum relatório já preencheu um valor
    pra ele. report_fields/report_item_fields têm ON DELETE CASCADE nessa
    FK, então apagar sem checar apagaria dado de relatório em silêncio."""
    supabase = get_client()

    used_in_reports = (
        supabase.table("report_fields").select("id").eq("form_field_id", field_id).limit(1).execute()
    ).data
    used_in_items = (
        supabase.table("report_item_fields").select("id").eq("form_field_id", field_id).limit(1).execute()
    ).data
    if used_in_reports or used_in_items:
        raise HTTPException(
            status_code=409,
            detail="Esse campo já tem valores preenchidos em algum relatório — não dá pra excluir sem perder esses dados.",
        )

    resp = (
        supabase.table("form_fields")
        .delete()
        .eq("id", field_id)
        .eq("form_template_id", template_id)
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Campo não encontrado nesse formulário.")
    return TemplateActionOut(success=True, id=field_id)


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