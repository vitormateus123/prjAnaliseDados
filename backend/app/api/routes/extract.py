# backend/app/api/routes/extract.py
import json
import logging
import time
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from typing import Optional
from app.schemas.extraction import ExtractResponse, FieldHint
from app.schemas.discovery import DiscoveryResult, DiscoveredField
from app.services import gemini_service, groq_service

logger = logging.getLogger("extract")
router = APIRouter()

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