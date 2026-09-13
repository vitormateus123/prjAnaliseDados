# backend/app/api/routes/templates.py
from fastapi import APIRouter, HTTPException
from app.services.supabase_service import get_client
from app.schemas.forms import FormTemplateOut, FormFieldOut

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
    return [FormFieldOut(**f) for f in (fields_resp.data or [])]


@router.get("/", response_model=list[FormTemplateOut])
def list_templates():
    """Lista os formulários ativos, cada um já com seus campos ordenados por 'position'.
    É isso que a FormSelectScreen do app consome no lugar do MOCK_FORM_TEMPLATES."""
    supabase = get_client()

    templates_resp = (
        supabase.table("form_templates")
        .select("*")
        .eq("active", True)
        .execute()
    )
    templates = templates_resp.data or []

    return [
        FormTemplateOut(
            id=template["id"],
            name=template["name"],
            description=template.get("description"),
            version=template["version"],
            active=template["active"],
            fields=_load_fields(template["id"]),
        )
        for template in templates
    ]


@router.get("/{template_id}", response_model=FormTemplateOut)
def get_template(template_id: str):
    """Um formulário específico — é isso que a CapturaScreen chama a partir
    do formTemplateId recebido por navegação."""
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

    template = rows[0]
    return FormTemplateOut(
        id=template["id"],
        name=template["name"],
        description=template.get("description"),
        version=template["version"],
        active=template["active"],
        fields=_load_fields(template_id),
    )
