# backend/app/api/routes/extract.py
import base64
import json
import logging
import time
import httpx
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from typing import Optional
from app.schemas.extraction import (
    ExtractResponse, FieldHint, ExtractedField,
    AutoExtractRequest, AutoExtractResponse, ExtractedItem,
    DynamicExtractedField, DynamicExtractedItem, EXTRACTION_PURPOSES,
    RefineRequest, RefineResponse,
)
from app.schemas.discovery import DiscoveryResult, DiscoveredField
from app.services import gemini_service, groq_service
from app.services.supabase_service import get_client
from app.api.routes.templates import FIELD_TYPES
from app.core.config import settings

logger = logging.getLogger("extract")
router = APIRouter()

_AUTO_MODEL = settings.gemini_model
MAX_AUTO_FILE_SIZE = 10 * 1024 * 1024  # 10 MB por arquivo (mesmo limite do /extract/ classico)

ALLOWED_MIME = {"image/jpeg", "image/png", "audio/m4a", "audio/mpeg", "audio/wav"}
MAX_SIZE = 10 * 1024 * 1024  # 10 MB


def _validate_file(content: bytes, content_type: str | None) -> None:
    if len(content) > MAX_SIZE:
        raise HTTPException(status_code=413, detail="Arquivo muito grande (max 10 MB).")
    if content_type not in ALLOWED_MIME:
        raise HTTPException(
            status_code=415,
            detail=f"Tipo de arquivo nao suportado: {content_type}",
        )


# ENDPOINT PRINCIPAL

@router.post("/")
async def extract_fields(
    media_type: str = Form(...),               # 'voice' | 'photo' | 'text'
    file: UploadFile = File(...),
    fields_json: Optional[str] = Form(None),  # None = modo descoberta
    extra_text: Optional[str] = Form(None),   # texto adicional para modo combinado
):
    """Extrai/descobre campos a partir de captura multimodal.

    Modos de operacao:
    - Guiado   (fields_json presente): IA preenche campos de um template existente.
    - Descoberta (fields_json ausente): IA analisa livremente e propoe contexto + campos.
    - Combinado (media_type='photo' + extra_text): foto + texto/transcricao juntos.
    """
    content = await file.read()
    _validate_file(content, file.content_type)
    t0 = time.monotonic()

    # MODO GUIADO (template presente)
    if fields_json is not None:
        try:
            fields = [FieldHint(**f) for f in json.loads(fields_json)]
        except Exception as e:
            raise HTTPException(status_code=422, detail=f"fields_json invalido: {e}")

        try:
            if media_type == "voice":
                transcript = await groq_service.transcribe_audio(content, file.content_type)
                t1 = time.monotonic()
                print(f"[extract/guided] Groq STT: {t1 - t0:.1f}s", flush=True)
                extracted = await gemini_service.extract_from_text(fields, transcript)
                t2 = time.monotonic()
                print(f"[extract/guided] Gemini extracao: {t2 - t1:.1f}s", flush=True)
                model = "whisper-large-v3 + gemini-2.0-flash-lite"
            else:
                extracted = await gemini_service.extract_from_media(fields, content, file.content_type)
                t1 = time.monotonic()
                print(f"[extract/guided] Gemini multimodal: {t1 - t0:.1f}s", flush=True)
                model = "gemini-2.0-flash-lite"
        except Exception as e:
            logger.exception("Falha na extracao guiada (%s)", media_type)
            return ExtractResponse(
                success=False, fields=[], provider="gemini",
                model="gemini-2.0-flash-lite", error=str(e),
            )
        return ExtractResponse(success=True, fields=extracted, provider="gemini", model=model)

    # MODO DESCOBERTA (sem template)
    try:
        if media_type == "voice":
            transcript = await groq_service.transcribe_audio(content, file.content_type)
            t1 = time.monotonic()
            print(f"[extract/discovery] Groq STT: {t1 - t0:.1f}s", flush=True)
            combined_text = transcript
            if extra_text:
                combined_text = f"{transcript}\n\n[Informacao adicional]:\n{extra_text}"
            result = await gemini_service.discover_and_extract_from_text(combined_text)
            t2 = time.monotonic()
            print(f"[extract/discovery] Gemini descoberta: {t2 - t1:.1f}s", flush=True)
        elif media_type == "photo" and extra_text:
            result = await gemini_service.discover_and_extract_multimodal(
                content, file.content_type, extra_text
            )
            t1 = time.monotonic()
            print(f"[extract/discovery] Gemini multimodal combinado: {t1 - t0:.1f}s", flush=True)
        else:
            result = await gemini_service.discover_and_extract_from_media(
                content, file.content_type
            )
            t1 = time.monotonic()
            print(f"[extract/discovery] Gemini foto: {t1 - t0:.1f}s", flush=True)
    except Exception as e:
        logger.exception("Falha na descoberta (%s)", media_type)
        return DiscoveryResult(
            success=False, fields=[], provider="gemini",
            model="gemini-2.0-flash-lite", error=str(e), mode="discovery",
        )
    return result


# ENDPOINT PARA TEXTO PURO (digitado pelo usuario)

@router.post("/text/")
async def extract_from_raw_text(
    text: str = Form(...),
    fields_json: Optional[str] = Form(None),
):
    """Recebe texto digitado pelo usuario e processa via IA.
    Modo descoberta por padrao — nao ha arquivo de midia."""
    t0 = time.monotonic()

    if fields_json is not None:
        try:
            fields = [FieldHint(**f) for f in json.loads(fields_json)]
        except Exception as e:
            raise HTTPException(status_code=422, detail=f"fields_json invalido: {e}")
        try:
            extracted = await gemini_service.extract_from_text(fields, text)
            t1 = time.monotonic()
            print(f"[extract/text/guided] Gemini: {t1 - t0:.1f}s", flush=True)
        except Exception as e:
            logger.exception("Falha na extracao de texto guiada")
            return DiscoveryResult(
                success=False, fields=[], provider="gemini",
                model="gemini-2.0-flash-lite", error=str(e), mode="guided",
            )
        return DiscoveryResult(
            success=True,
            fields=[DiscoveredField(
                key=f.key, label=f.key.replace("_", " ").title(),
                type="text", value=f.value, confidence=f.confidence,
            ) for f in extracted],
            provider="gemini",
            model="gemini-2.0-flash-lite",
            mode="guided",
        )

    try:
        result = await gemini_service.discover_and_extract_from_text(text)
        t1 = time.monotonic()
        print(f"[extract/text/discovery] Gemini: {t1 - t0:.1f}s", flush=True)
    except Exception as e:
        logger.exception("Falha na descoberta de texto")
        return DiscoveryResult(
            success=False, fields=[], provider="gemini",
            model="gemini-2.0-flash-lite", error=str(e), mode="discovery",
        )
    return result


# ENDPOINT AUTOMATICO (sem template escolhido pelo usuario)
# Recebe foto(s)/audio/texto de uma MESMA captura (montados aos poucos na
# CapturaScreen) e devolve tanto a classificacao quanto os valores extraidos
# numa unica chamada. Ver AutoExtractionService.ts no app.

def _safe_field_type(raw_type: str | None) -> str:
    return raw_type if raw_type in FIELD_TYPES else "text"


def _fetch_template_catalog() -> list[dict]:
    """Formularios ativos + campos, no formato que o prompt de classificacao
    espera (ver TemplateCatalogEntry/TemplateCatalogField)."""
    supabase = get_client()
    templates_resp = supabase.table("form_templates").select("*").eq("active", True).execute()
    templates = templates_resp.data or []

    catalog: list[dict] = []
    for t in templates:
        fields_resp = (
            supabase.table("form_fields")
            .select("*")
            .eq("form_template_id", t["id"])
            .order("position")
            .execute()
        )
        catalog.append({
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
                for f in (fields_resp.data or [])
            ],
        })
    return catalog


def _add_suggested_fields(template_id: str, suggested_fields: list[dict]) -> list[str]:
    """Preenche lacunas num template JA existente — ignora keys que ja
    existirem nele (evita duplicar em capturas repetidas do mesmo tipo)."""
    if not suggested_fields:
        return []
    supabase = get_client()
    existing = (
        supabase.table("form_fields")
        .select("key,position")
        .eq("form_template_id", template_id)
        .execute()
    ).data or []
    existing_keys = {f["key"] for f in existing}
    next_position = max((f["position"] for f in existing), default=-1) + 1

    new_keys: list[str] = []
    rows = []
    for f in suggested_fields:
        key = f.get("key")
        if not key or key in existing_keys:
            continue
        rows.append({
            "form_template_id": template_id,
            "key": key,
            "label": f.get("label") or key,
            "type": _safe_field_type(f.get("type")),
            "required": False,
            "position": next_position,
            "extraction_hint": f.get("extraction_hint"),
            "options": f.get("options"),
            "is_item_field": bool(f.get("is_item_field", False)),
            "source": "ai_generated",
        })
        existing_keys.add(key)
        new_keys.append(key)
        next_position += 1

    if rows:
        supabase.table("form_fields").insert(rows).execute()
    return new_keys


def _auto_error(message: str, retryable: bool = True) -> AutoExtractResponse:
    return AutoExtractResponse(
        success=False, provider="gemini", model=_AUTO_MODEL,
        error=message, retryable=retryable,
    )


@router.post("/auto", response_model=AutoExtractResponse)
async def extract_auto(payload: AutoExtractRequest):
    """Fluxo automatico: recebe foto(s)/audio/texto de uma mesma captura (sem
    template escolhido). A IA classifica contra os formularios existentes
    (match="existing") ou estrutura livremente, sem criar template novo
    (match="dynamic") — e ja extrai os valores. Tudo numa chamada."""
    if not payload.photos and not payload.audio and not (payload.text or "").strip():
        return _auto_error("Nenhuma informação anexada para enviar.", retryable=False)

    purpose = payload.purpose if payload.purpose in EXTRACTION_PURPOSES else None
    custom_instruction = (payload.custom_instruction or "").strip() or None

    t0 = time.monotonic()
    try:
        photos_bytes: list[tuple[bytes, str]] = []
        for p in payload.photos:
            data = base64.b64decode(p.data)
            if len(data) > MAX_AUTO_FILE_SIZE:
                return _auto_error("Uma das fotos é grande demais (máx. 10 MB).", retryable=False)
            photos_bytes.append((data, p.mime_type))

        transcript = None
        if payload.audio:
            audio_bytes = base64.b64decode(payload.audio.data)
            if len(audio_bytes) > MAX_AUTO_FILE_SIZE:
                return _auto_error("O áudio é grande demais (máx. 10 MB).", retryable=False)
            transcript = await groq_service.transcribe_audio(audio_bytes, payload.audio.mime_type)
            t1 = time.monotonic()
            print(f"[extract/auto] Groq STT: {t1 - t0:.1f}s", flush=True)

        typed_text = (payload.text or "").strip() or None
        if transcript and typed_text:
            combined_text = f"{transcript}\n\n[Texto digitado adicional]:\n{typed_text}"
        else:
            combined_text = transcript or typed_text

        catalog = _fetch_template_catalog()
        result = await gemini_service.classify_and_extract(
            catalog, photos_bytes, combined_text, purpose, custom_instruction,
        )
        t2 = time.monotonic()
        print(f"[extract/auto] Gemini classificação+extração: {t2 - t0:.1f}s", flush=True)
    except Exception as e:
        logger.exception("Falha no modo automatico (classificacao/extracao)")
        return _auto_error(str(e))

    try:
        match = result.get("match")

        # ─── match="existing": reaproveita um formulário já cadastrado ───
        if match == "existing" and result.get("template_id"):
            template_id = result["template_id"]
            new_field_keys = _add_suggested_fields(template_id, result.get("suggested_fields") or [])
            template_row_resp = (
                get_client().table("form_templates")
                .select("name,has_items")
                .eq("id", template_id)
                .execute()
            )
            if not template_row_resp.data:
                raise ValueError(f"Formulário {template_id} indicado pela IA não existe no banco.")
            template_row = template_row_resp.data[0]
            template_name = template_row["name"]
            has_items = bool(template_row.get("has_items", False))

            fields = [ExtractedField(**f) for f in (result.get("fields") or [])]
            items = (
                [ExtractedItem(fields=[ExtractedField(**f) for f in (it.get("fields") or [])])
                 for it in (result.get("items") or [])]
                if has_items else []
            )

            return AutoExtractResponse(
                success=True,
                structure_mode="guided",
                template_id=template_id,
                template_name=template_name,
                has_items=has_items,
                fields=fields,
                items=items,
                provider="gemini",
                model=_AUTO_MODEL,
                new_field_keys=new_field_keys,
            )

        # ─── match="dynamic" (ou fallback se a IA não indicou template_id
        #     válido): estrutura livre, sem criar form_template ────────────
        dynamic_fields = [DynamicExtractedField(**f) for f in (result.get("dynamic_fields") or [])]
        dynamic_items = [
            DynamicExtractedItem(fields=[DynamicExtractedField(**f) for f in (it.get("fields") or [])])
            for it in (result.get("dynamic_items") or [])
        ]
        if not dynamic_fields and not dynamic_items:
            raise ValueError("A IA não retornou nem um template válido nem uma estrutura dinâmica.")

        return AutoExtractResponse(
            success=True,
            structure_mode="dynamic",
            context_label=result.get("context_label") or None,
            context_type=result.get("context_type") or None,
            dynamic_fields=dynamic_fields,
            dynamic_items=dynamic_items,
            provider="gemini",
            model=_AUTO_MODEL,
        )
    except Exception as e:
        logger.exception("Falha ao processar classificacao/estruturacao no modo automatico")
        return _auto_error(f"Erro ao interpretar resposta da IA: {e}")

# ─── ENDPOINT DE REFINAMENTO ─────────────────────────────────────────────────
# Recebe as capturas ORIGINAIS (base64 local OU file_url remota) e a lista de
# campos alvo para re-extrair. Usado pelo app quando o usuário pede para a IA
# tentar de novo em campos específicos (errados/vazios), preencher um campo
# adicionado manualmente, ou regenerar tudo de uma vez.

MAX_REFINE_FILE_SIZE = 10 * 1024 * 1024  # 10 MB


async def _resolve_refine_media(item) -> tuple[bytes, str]:
    """Resolve um RefineMediaItem para (bytes, mime_type).
    Aceita base64 (arquivo local) ou file_url (captura já sincronizada)."""
    if item.data:
        data = base64.b64decode(item.data)
        if len(data) > MAX_REFINE_FILE_SIZE:
            raise HTTPException(
                status_code=413,
                detail="Arquivo muito grande para refinamento (máx. 10 MB).",
            )
        return data, item.mime_type

    if item.file_url:
        # Captura já sincronizada: baixa do Storage via URL assinada.
        # Timeout generoso — a URL pode ser de qualquer provedor de storage.
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(item.file_url)
        if resp.status_code != 200:
            raise HTTPException(
                status_code=502,
                detail=f"Não foi possível baixar a mídia remota (status {resp.status_code}).",
            )
        data = resp.content
        if len(data) > MAX_REFINE_FILE_SIZE:
            raise HTTPException(
                status_code=413,
                detail="Arquivo remoto muito grande para refinamento (máx. 10 MB).",
            )
        return data, item.mime_type

    raise HTTPException(
        status_code=422,
        detail="Cada mídia de refinamento precisa ter 'data' (base64) ou 'file_url'.",
    )


@router.post("/refine", response_model=RefineResponse)
async def refine_fields(payload: RefineRequest):
    """Re-extrai campos específicos a partir das capturas originais.

    Casos de uso:
    - Campo individual errado ou vazio → regenerar só ele.
    - Campo adicionado manualmente → pedir à IA que preencha.
    - Todos os campos → regenerar tudo (exceto os que o chamador optar por manter).

    Aceita mídias locais (base64) ou remotas (file_url assinada) — o app
    manda base64 quando o arquivo local existe e file_url quando a captura
    já foi sincronizada e o arquivo local não está mais disponível.
    """
    if not payload.target_fields:
        return RefineResponse(
            success=False,
            provider="gemini",
            model=settings.gemini_model,
            error="Nenhum campo alvo informado.",
            retryable=False,
        )

    t0 = time.monotonic()
    try:
        # ── fotos ──
        photos_bytes: list[tuple[bytes, str]] = []
        for p in payload.photos:
            photos_bytes.append(await _resolve_refine_media(p))

        # ── áudio: transcreve se necessário ──
        text = (payload.text or "").strip() or None
        if payload.audio:
            audio_bytes, audio_mime = await _resolve_refine_media(payload.audio)
            transcript = await groq_service.transcribe_audio(audio_bytes, audio_mime)
            t1 = time.monotonic()
            print(f"[extract/refine] Groq STT: {t1 - t0:.1f}s", flush=True)
            text = (f"{transcript}\n\n[Texto adicional]:\n{text}" if text else transcript)

        # ── extração guiada dos campos alvo ──
        extracted = await gemini_service.refine_fields(
            payload.target_fields,
            photos_bytes,
            text,
        )
        t2 = time.monotonic()
        print(f"[extract/refine] Gemini refinamento ({len(payload.target_fields)} campos): {t2 - t0:.1f}s", flush=True)

        return RefineResponse(
            success=True,
            fields=extracted,
            provider="gemini",
            model=settings.gemini_model,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Falha no refinamento de campos")
        return RefineResponse(
            success=False,
            provider="gemini",
            model=settings.gemini_model,
            error=str(e),
            retryable=True,
        )