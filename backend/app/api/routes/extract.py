# backend/app/api/routes/extract.py
import json
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from app.schemas.extraction import ExtractResponse, FieldHint, ExtractedField
from app.services import gemini_service, groq_service

router = APIRouter()

@router.post("/", response_model=ExtractResponse)
async def extract_fields(
    fields_json: str = Form(...),       # JSON string com lista de FieldHint
    media_type: str = Form(...),        # 'voice' ou 'photo'
    file: UploadFile = File(...),
):
    # Valida tamanho do arquivo (máx 10 MB)
    MAX_SIZE = 10 * 1024 * 1024
    content = await file.read()
    if len(content) > MAX_SIZE:
        raise HTTPException(status_code=413, detail="Arquivo muito grande (máx 10 MB).")
    
    # Valida MIME type permitido
    allowed_mime = {"image/jpeg", "image/png", "audio/m4a", "audio/mpeg", "audio/wav"}
    if file.content_type not in allowed_mime:
        raise HTTPException(status_code=415, detail=f"Tipo de arquivo não suportado: {file.content_type}")
    
    try:
        fields = [FieldHint(**f) for f in json.loads(fields_json)]
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"fields_json inválido: {e}")
    
    try:
        if media_type == "voice":
            # STT primeiro, depois extração via texto
            transcript = await groq_service.transcribe_audio(content, file.content_type)
            # Usa o texto transcrito como input para o Gemini (mais barato que multimodal)
            extracted_fields = await gemini_service.extract_from_text(fields, transcript)
            model = "whisper-large-v3 + gemini-2.5-flash"
        else:
            # Foto direto para Gemini multimodal
            extracted_fields = await gemini_service.extract_from_media(fields, content, file.content_type)
            model = "gemini-2.5-flash"
    except Exception as e:
        return ExtractResponse(
            success=False, fields=[], provider="gemini",
            model="gemini-2.5-flash", error=str(e),
        )
    
    return ExtractResponse(
        success=True,
        fields=extracted_fields,
        provider="gemini",
        model=model,
    )