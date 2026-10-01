# backend/app/services/template_catalog.py
"""Catálogo de formulários ativos + campos, no formato que o prompt de
classificação espera (ver TemplateCatalogEntry/TemplateCatalogField).

Compartilhado entre /extract/auto (client com o JWT do usuário, sujeito a RLS)
e o worker de extração offline (client admin) — quem chama passa o client.
"""
from supabase import Client


def fetch_template_catalog(supabase: Client) -> list[dict]:
    templates = (
        supabase.table("form_templates").select("*").eq("active", True).execute().data
    ) or []
    if not templates:
        return []

    # Uma única consulta para todos os campos (antes: uma por formulário).
    fields = (
        supabase.table("form_fields")
        .select("*")
        .in_("form_template_id", [t["id"] for t in templates])
        .order("position")
        .execute()
        .data
    ) or []
    fields_by_template: dict[str, list[dict]] = {}
    for f in fields:
        fields_by_template.setdefault(f["form_template_id"], []).append(f)

    return [
        {
            "id": t["id"],
            "name": t["name"],
            "description": t.get("description"),
            "has_items": t.get("has_items", False),
            "fields": [
                {
                    "key": f["key"],
                    "label": f["label"],
                    "type": f["type"],
                    "extraction_hint": f.get("extraction_hint"),
                    "options": f.get("options"),
                    "is_item_field": f.get("is_item_field", False),
                }
                for f in fields_by_template.get(t["id"], [])
            ],
        }
        for t in templates
    ]