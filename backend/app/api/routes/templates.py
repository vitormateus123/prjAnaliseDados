# backend/app/api/routes/templates.py
# Stub inicial — hoje o app carrega os formulários de src/mock/formTemplates.ts
# (offline-first). Este endpoint existe para permitir a migração futura dos
# templates para o Supabase (tabela form_templates) sem alterar o contrato
# da API consumida pelo app.
from fastapi import APIRouter, HTTPException

router = APIRouter()

# TODO (fase futura): substituir por consulta ao Supabase (form_templates + form_fields)
_TEMPLATES: list[dict] = []


@router.get("/")
def list_templates():
    return {"templates": _TEMPLATES}


@router.get("/{template_id}")
def get_template(template_id: str):
    for template in _TEMPLATES:
        if template.get("id") == template_id:
            return template
    raise HTTPException(status_code=404, detail="Formulário não encontrado")