# backend/app/api/routes/extract.py
import json
import logging
import time
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from app.schemas.extraction import (
    ExtractResponse, FieldHint, AutoExtractResponse,
    TemplateCatalogEntry, TemplateCatalogField,
)
from app.schemas.forms import FormFieldOut, FormTemplateOut
from app.services import gemini_service, groq_service
from app.services.gemini_service import ExtractionError
from app.services.supabase_service import get_client

logger = logging.getLogger("extract")
router = APIRouter()

MAX_SIZE = 10 * 1024 * 1024
ALLOWED_MIME = {"image/jpeg", "image/png", "audio/m4a", "audio/mpeg", "audio/wav"}


async def _read_and_validate(file: UploadFile) -> bytes:
    content = await file.read()
    if len(content) > MAX_SIZE:
        raise HTTPException(status_code=413, detail="Arquivo muito grande (máx 10 MB).")
    if file.content_type not in ALLOWED_MIME:
        raise HTTPException(
            status_code=415, detail=f"Tipo de arquivo não suportado: {file.content_type}"
        )
    return content


@router.post("/", response_model=ExtractResponse)
async def extract_fields(
    fields_json: str = Form(...),       # JSON string com lista de FieldHint
    media_type: str = Form(...),        # 'voice' ou 'photo'
    file: UploadFile = File(...),
):
    """Extração 'clássica': o app já escolheu o form_template_id e manda os
    campos dele. Mantido para compatibilidade — o fluxo novo é /extract/auto."""
    content = await _read_and_validate(file)

    try:
        fields = [FieldHint(**f) for f in json.loads(fields_json)]
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"fields_json inválido: {e}")

    try:
        t0 = time.monotonic()
        if media_type == "voice":
            transcript = await groq_service.transcribe_audio(content, file.content_type)
            t1 = time.monotonic()
            print(f"[extract] Groq (transcrição) levou {t1 - t0:.1f}s", flush=True)
            extracted_fields = await gemini_service.extract_from_text(fields, transcript)
            t2 = time.monotonic()
            print(f"[extract] Gemini (extração) levou {t2 - t1:.1f}s", flush=True)
            model = f"whisper-large-v3 + {gemini_service.MODEL}"
        else:
            extracted_fields = await gemini_service.extract_from_media(
                fields, content, file.content_type
            )
            t1 = time.monotonic()
            print(f"[extract] Gemini (extração multimodal) levou {t1 - t0:.1f}s", flush=True)
            model = gemini_service.MODEL
    except ExtractionError as e:
        print(f"[extract] FALHOU ({'retryable' if e.retryable else 'não-retryable'}): {e}", flush=True)
        logger.warning("Extração falhou (%s): %s", media_type, e)
        return ExtractResponse(
            success=False, fields=[], provider="gemini",
            model=gemini_service.MODEL, error=str(e), retryable=e.retryable,
        )
    except Exception as e:
        print(f"[extract] FALHOU: {type(e).__name__}: {e}", flush=True)
        logger.exception("Falha na extração (%s)", media_type)
        return ExtractResponse(
            success=False, fields=[], provider="gemini", model=gemini_service.MODEL,
            error="Falha inesperada ao processar a captura. Tente novamente.",
        )

    return ExtractResponse(
        success=True, fields=extracted_fields, provider="gemini", model=model,
    )


# ─── /extract/auto — classifica/propõe template e extrai, sem o app precisar
#     escolher o formulário antes ────────────────────────────────────────

def _load_catalog() -> list[TemplateCatalogEntry]:
    """Templates ativos, aprovados OU pendentes de revisão — pendentes entram
    porque senão o mesmo tipo "novo" nunca seria reconhecido de novo na
    segunda vez que aparecer, e a IA ficaria criando um template diferente
    a cada captura parecida."""
    supabase = get_client()
    templates_resp = (
        supabase.table("form_templates").select("*").eq("active", True).execute()
    )
    templates = templates_resp.data or []
    catalog = []
    for t in templates:
        fields_resp = (
            supabase.table("form_fields")
            .select("*")
            .eq("form_template_id", t["id"])
            .order("position")
            .execute()
        )
        catalog.append(
            TemplateCatalogEntry(
                id=t["id"],
                name=t["name"],
                description=t.get("description"),
                has_items=t.get("has_items", False),
                fields=[
                    TemplateCatalogField(
                        key=f["key"], label=f["label"], type=f["type"],
                        extraction_hint=f.get("extraction_hint"),
                        options=f.get("options"),
                        is_item_field=f.get("is_item_field", False),
                    )
                    for f in (fields_resp.data or [])
                ],
            )
        )
    return catalog


def _create_dynamic_template(proposed) -> FormTemplateOut:
    """Grava o template proposto pela IA no Supabase (source='ai_generated',
    review_status='pending') e devolve já com os IDs reais — o app precisa
    desses IDs pra montar report_fields depois."""
    supabase = get_client()

    template_resp = (
        supabase.table("form_templates")
        .insert({
            "name": proposed.name,
            "description": proposed.description,
            "version": 1,
            "active": True,
            "has_items": proposed.has_items,
            "source": "ai_generated",
            "review_status": "pending",
        })
        .execute()
    )
    if not template_resp.data:
        raise HTTPException(status_code=500, detail="Falha ao criar o template proposto pela IA.")
    template_row = template_resp.data[0]

    field_rows = [
        {
            "form_template_id": template_row["id"],
            "key": f.key,
            "label": f.label,
            "type": f.type,
            "required": False,
            "position": i,
            "extraction_hint": f.extraction_hint,
            "options": f.options,
            "is_item_field": f.is_item_field,
        }
        for i, f in enumerate(proposed.fields)
    ]
    fields_out: list[FormFieldOut] = []
    if field_rows:
        fields_resp = supabase.table("form_fields").insert(field_rows).execute()
        for f in fields_resp.data or []:
            fields_out.append(
                FormFieldOut(
                    id=f["id"], key=f["key"], label=f["label"], type=f["type"],
                    required=f["required"], position=f["position"],
                    extraction_hint=f.get("extraction_hint"), options=f.get("options"),
                    is_item_field=f.get("is_item_field", False),
                )
            )

    return FormTemplateOut(
        id=template_row["id"], name=template_row["name"],
        description=template_row.get("description"), version=template_row["version"],
        active=template_row["active"], has_items=template_row.get("has_items", False),
        fields=fields_out,
    )


def _catalog_entry_to_template_out(entry: TemplateCatalogEntry) -> FormTemplateOut:
    return FormTemplateOut(
        id=entry.id, name=entry.name, description=entry.description,
        version=1, active=True, has_items=entry.has_items,
        fields=[
            FormFieldOut(
                id="", key=f.key, label=f.label, type=f.type, required=False, position=i,
                extraction_hint=f.extraction_hint, options=f.options,
                is_item_field=f.is_item_field,
            )
            for i, f in enumerate(entry.fields)
        ],
    )


@router.post("/auto", response_model=AutoExtractResponse)
async def extract_auto(
    media_type: str = Form(...),   # 'voice' ou 'photo'
    file: UploadFile = File(...),
):
    """Fluxo novo: o app manda só a mídia, sem escolher formulário antes.
    1. transcreve (voz) ou usa a foto direto;
    2. pede pra IA classificar entre os templates existentes, ou propor um novo;
    3. se propôs novo, grava no banco (pending de revisão, mas já utilizável);
    4. extrai os campos (ou itens, se has_items=True) pro template resolvido."""
    content = await _read_and_validate(file)

    try:
        transcript: str | None = None
        media_bytes: bytes | None = None
        mime_type: str | None = None

        if media_type == "voice":
            transcript = await groq_service.transcribe_audio(content, file.content_type)
        else:
            media_bytes = content
            mime_type = file.content_type

        catalog = _load_catalog()
        classification = await gemini_service.classify_or_propose(
            catalog, text=transcript, media_bytes=media_bytes, mime_type=mime_type,
        )

        template_is_new = classification.match == "new"
        if template_is_new:
            if not classification.new_template:
                raise HTTPException(
                    status_code=422,
                    detail="A IA indicou 'new' mas não propôs um template.",
                )
            template = _create_dynamic_template(classification.new_template)
        else:
            entry = next((t for t in catalog if t.id == classification.template_id), None)
            if entry is None:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"A IA apontou o template {classification.template_id}, mas ele "
                        "não foi encontrado no catálogo carregado."
                    ),
                )
            template = _catalog_entry_to_template_out(entry)

        fields = [
            FieldHint(
                key=f.key, label=f.label, type=f.type,
                extraction_hint=f.extraction_hint, is_item_field=f.is_item_field,
            )
            for f in template.fields
        ]
        flat, items = await gemini_service.extract_for_template(
            fields, template.has_items, text=transcript, media_bytes=media_bytes, mime_type=mime_type,
        )

        model = (
            f"whisper-large-v3 + {gemini_service.MODEL}"
            if media_type == "voice" else gemini_service.MODEL
        )

        return AutoExtractResponse(
            success=True,
            template_id=template.id,
            template_name=template.name,
            template_is_new=template_is_new,
            has_items=template.has_items,
            fields=flat,
            items=items,
            provider="gemini",
            model=model,
            # devolve o template completo via header seria estranho — o app
            # busca com GET /templates/{id} logo em seguida (já tem cache).
        )
    except HTTPException:
        raise
    except ExtractionError as e:
        logger.warning("Extração automática falhou (%s): %s", media_type, e)
        return AutoExtractResponse(
            success=False, template_id="", template_name="", template_is_new=False,
            has_items=False, fields=[], items=[], provider="gemini",
            model=gemini_service.MODEL, error=str(e), retryable=e.retryable,
        )
    except Exception as e:
        logger.exception("Falha na extração automática (%s)", media_type)
        return AutoExtractResponse(
            success=False, template_id="", template_name="", template_is_new=False,
            has_items=False, fields=[], items=[], provider="gemini",
            model=gemini_service.MODEL,
            error="Falha inesperada ao processar a captura. Tente novamente.",
        )