# backend/app/services/gemini_service.py
import base64
import json
import google.generativeai as genai
from app.core.config import settings
from app.schemas.extraction import ExtractedField, FieldHint

genai.configure(api_key=settings.gemini_api_key)

PROMPT_TEMPLATE = """Você é um assistente que extrai informações estruturadas de relatos de trabalhadores de campo (voz ou foto).

CAMPOS PARA EXTRAIR:
{fields_spec}

REGRAS:
- Extraia apenas informações presentes no conteúdo.
- Nunca invente informações.
- Para campos não encontrados, retorne string vazia "".
- Retorne APENAS o JSON pedido, sem texto adicional.
- Para campos de data, use o formato YYYY-MM-DD.
- Para campos de seleção, retorne exatamente uma das opções fornecidas.

Retorne um JSON com esta estrutura exata:
{{"fields": [{{"key": "chave_do_campo", "value": "valor_extraído", "confidence": 0.95}}]}}
"""

def _build_fields_spec(fields: list[FieldHint]) -> str:
    lines = []
    for f in fields:
        hint = f.extraction_hint or f"Extraia o valor para: {f.label}"
        lines.append(f"- {f.key} ({f.type}): {hint}")
    return "\n".join(lines)

_RESPONSE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "fields": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "key": {"type": "STRING"},
                    "value": {"type": "STRING"},
                    "confidence": {"type": "NUMBER"},
                },
                "required": ["key", "value", "confidence"],
            }
        }
    },
    "required": ["fields"],
}

async def extract_from_media(
    fields: list[FieldHint],
    media_bytes: bytes,
    mime_type: str,
) -> list[ExtractedField]:
    model = genai.GenerativeModel("gemini-3.5-flash-lite")
    
    fields_spec = _build_fields_spec(fields)
    prompt = PROMPT_TEMPLATE.format(fields_spec=fields_spec)
    
    # Monta o conteúdo multimodal
    content_parts = [
        prompt,
        {"mime_type": mime_type, "data": base64.b64encode(media_bytes).decode()},
    ]
    
    response = model.generate_content(
        content_parts,
        generation_config=genai.GenerationConfig(
            response_mime_type="application/json",
            response_schema=_RESPONSE_SCHEMA,
        ),
    )
    
    data = json.loads(response.text)
    return [ExtractedField(**f) for f in data["fields"]]

async def extract_from_text(
    fields: list[FieldHint],
    text: str,
) -> list[ExtractedField]:
    """Usado no fluxo de voz: recebe a transcrição (Groq/Whisper) como texto
    puro e pede ao Gemini para extrair os campos estruturados a partir dela."""
    model = genai.GenerativeModel("gemini-3.5-flash-lite")

    fields_spec = _build_fields_spec(fields)
    prompt = (
        PROMPT_TEMPLATE.format(fields_spec=fields_spec)
        + f"\n\nTEXTO TRANSCRITO (fala do usuário):\n{text}"
    )

    response = model.generate_content(
        prompt,
        generation_config=genai.GenerationConfig(
            response_mime_type="application/json",
            response_schema=_RESPONSE_SCHEMA,
        ),
    )

    data = json.loads(response.text)
    return [ExtractedField(**f) for f in data["fields"]]