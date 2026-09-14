# backend/app/services/gemini_service.py
import json
from google import genai
from google.genai import types
from app.core.config import settings
from app.schemas.extraction import ExtractedField, FieldHint

_client = genai.Client(api_key=settings.gemini_api_key)

# O nome do modelo vem do .env (GEMINI_MODEL) justamente porque o Google
# aposenta modelos periodicamente — o gemini-2.0-flash-lite foi desligado em
# 01/06/2026 e passou a responder 404. Trocar de modelo não deve exigir deploy.
#
# Padrão atual: gemini-3.5-flash-lite — multimodal (texto, imagem, áudio, PDF),
# o mais barato da família 3.5 e otimizado para extração estruturada.
# Observação para a família 3.x: temperature/top_p/top_k são ignorados e o
# thinking_level já vem em "minimal" no Flash-Lite, que é o que queremos aqui.
MODEL = settings.gemini_model
PROVIDER = "gemini"

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


class ExtractionError(Exception):
    """Falha ao obter uma extração utilizável do modelo."""


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


def _generate_config() -> types.GenerateContentConfig:
    # Nada de temperature/top_p/top_k: a partir do Gemini 3 esses valores
    # são ignorados (e penalties chegam a lançar erro).
    return types.GenerateContentConfig(
        response_mime_type="application/json",
        response_schema=_RESPONSE_SCHEMA,
    )


def _parse_fields_response(response) -> list[ExtractedField]:
    raw = getattr(response, "text", None)
    if not raw:
        # Acontece quando a resposta é bloqueada por safety ou vem vazia.
        # Sem isso, o json.loads estouraria com um TypeError confuso.
        raise ExtractionError(
            "O modelo não retornou conteúdo. Verifique se a imagem/áudio é legível."
        )
    try:
        data = json.loads(raw)
        return [ExtractedField(**f) for f in data["fields"]]
    except (json.JSONDecodeError, KeyError, TypeError) as err:
        raise ExtractionError(f"Resposta do modelo em formato inesperado: {err}") from err


async def extract_from_media(
    fields: list[FieldHint],
    media_bytes: bytes,
    mime_type: str,
) -> list[ExtractedField]:
    """Extrai campos a partir de uma imagem usando Gemini multimodal.
    Usa _client.aio para não bloquear o event loop do FastAPI."""
    fields_spec = _build_fields_spec(fields)
    prompt = PROMPT_TEMPLATE.format(fields_spec=fields_spec)

    response = await _client.aio.models.generate_content(
        model=MODEL,
        contents=[
            prompt,
            types.Part.from_bytes(data=media_bytes, mime_type=mime_type),
        ],
        config=_generate_config(),
    )

    return _parse_fields_response(response)


async def extract_from_text(
    fields: list[FieldHint],
    text: str,
) -> list[ExtractedField]:
    """Usado no fluxo de voz: recebe a transcrição (Groq/Whisper) como texto
    puro e pede ao Gemini para extrair os campos estruturados a partir dela.
    Usa _client.aio para não bloquear o event loop do FastAPI."""
    fields_spec = _build_fields_spec(fields)
    prompt = (
        PROMPT_TEMPLATE.format(fields_spec=fields_spec)
        + f"\n\nTEXTO TRANSCRITO (fala do usuário):\n{text}"
    )

    response = await _client.aio.models.generate_content(
        model=MODEL,
        contents=prompt,
        config=_generate_config(),
    )

    return _parse_fields_response(response)