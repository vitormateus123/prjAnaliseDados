# backend/app/services/gemini_service.py
import json
from google import genai
from google.genai import types
from app.core.config import settings
from app.schemas.extraction import ExtractedField, FieldHint
from app.schemas.discovery import DiscoveredField, DiscoveryResult

_client = genai.Client(api_key=settings.gemini_api_key)

# Nome do modelo vem de settings (env GEMINI_MODEL) — NÃO hardcode aqui.
# O gemini-2.0-flash-lite foi desativado pelo Google em 01/06/2026 (ver
# core/config.py); manter o valor fixo faria toda extração falhar com 404.
_MODEL = settings.gemini_model

# ─── MODO GUIADO (com template) ─────────────────────────────────────────────

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


_GUIDED_RESPONSE_SCHEMA = {
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


def _guided_config() -> types.GenerateContentConfig:
    return types.GenerateContentConfig(
        response_mime_type="application/json",
        response_schema=_GUIDED_RESPONSE_SCHEMA,
    )


def _parse_guided_response(response) -> list[ExtractedField]:
    data = json.loads(response.text)
    return [ExtractedField(**f) for f in data["fields"]]


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
        model=_MODEL,
        contents=[
            prompt,
            types.Part.from_bytes(data=media_bytes, mime_type=mime_type),
        ],
        config=_guided_config(),
    )

    return _parse_guided_response(response)


async def extract_from_text(
    fields: list[FieldHint],
    text: str,
) -> list[ExtractedField]:
    """Usado no fluxo de voz: recebe a transcrição (Groq/Whisper) como texto
    puro e pede ao Gemini para extrair os campos estruturados a partir dela."""
    fields_spec = _build_fields_spec(fields)
    prompt = (
        PROMPT_TEMPLATE.format(fields_spec=fields_spec)
        + f"\n\nTEXTO TRANSCRITO (fala do usuário):\n{text}"
    )

    response = await _client.aio.models.generate_content(
        model=_MODEL,
        contents=prompt,
        config=_guided_config(),
    )

    return _parse_guided_response(response)


# ─── MODO DESCOBERTA (sem template) ─────────────────────────────────────────

_DISCOVERY_PROMPT = """Você é um assistente especializado em analisar qualquer tipo de informação e estruturá-la de forma organizada.

Analise o conteúdo recebido e responda:

1. O que é este conteúdo? (descreva em linguagem natural simples, ex: "Nota fiscal de serviços", "Relatório de inspeção de equipamento", "Relato de ocorrência")
2. Um identificador curto em snake_case para esse tipo (ex: nota_fiscal, inspecao_equipamento, ocorrencia)
3. Quais informações relevantes existem? Proponha campos estruturados.

REGRAS:
- Extraia apenas informações que realmente aparecem no conteúdo.
- Nunca invente informações.
- Para valores não encontrados, use string vazia "".
- Para campos de data, use formato YYYY-MM-DD.
- Tipos válidos: text, long_text, number, decimal, date, boolean
- Escolha chaves (key) em snake_case, descritivas e sem espaços.
- Escolha rótulos (label) em português, claros para um usuário leigo.
- A confiança (confidence) deve refletir sua certeza: 1.0 = certeza absoluta, 0.5 = incerto.
- Retorne APENAS o JSON pedido, sem texto adicional.

JSON esperado:
{{
  "context": "descrição em linguagem natural clara",
  "context_type": "slug_identificador",
  "fields": [
    {{"key": "chave", "label": "Rótulo legível", "type": "text", "value": "valor extraído", "confidence": 0.9}}
  ]
}}
"""

_DISCOVERY_RESPONSE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "context": {"type": "STRING"},
        "context_type": {"type": "STRING"},
        "fields": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "key": {"type": "STRING"},
                    "label": {"type": "STRING"},
                    "type": {"type": "STRING"},
                    "value": {"type": "STRING"},
                    "confidence": {"type": "NUMBER"},
                },
                "required": ["key", "label", "type", "value", "confidence"],
            }
        }
    },
    "required": ["context", "context_type", "fields"],
}


def _discovery_config() -> types.GenerateContentConfig:
    return types.GenerateContentConfig(
        response_mime_type="application/json",
        response_schema=_DISCOVERY_RESPONSE_SCHEMA,
    )


def _parse_discovery_response(response) -> tuple[str, str, list[DiscoveredField]]:
    data = json.loads(response.text)
    context = data.get("context", "")
    context_type = data.get("context_type", "informacao")
    fields = [DiscoveredField(**f) for f in data.get("fields", [])]
    return context, context_type, fields


async def discover_and_extract_from_media(
    media_bytes: bytes,
    mime_type: str,
) -> DiscoveryResult:
    """Modo descoberta: analisa imagem livremente, sem template.
    A IA identifica o contexto e propõe os campos por conta própria."""
    try:
        response = await _client.aio.models.generate_content(
            model=_MODEL,
            contents=[
                _DISCOVERY_PROMPT,
                types.Part.from_bytes(data=media_bytes, mime_type=mime_type),
            ],
            config=_discovery_config(),
        )
        context, context_type, fields = _parse_discovery_response(response)
        return DiscoveryResult(
            success=True,
            context=context,
            context_type=context_type,
            fields=fields,
            provider="gemini",
            model=_MODEL,
            mode="discovery",
        )
    except Exception as e:
        return DiscoveryResult(
            success=False,
            fields=[],
            provider="gemini",
            model=_MODEL,
            error=str(e),
            mode="discovery",
        )


async def discover_and_extract_from_text(
    text: str,
) -> DiscoveryResult:
    """Modo descoberta: analisa texto transcrito (voz) livremente, sem template.
    Também recebe texto digitado diretamente pelo usuário."""
    try:
        prompt = _DISCOVERY_PROMPT + f"\n\nCONTEÚDO A ANALISAR:\n{text}"
        response = await _client.aio.models.generate_content(
            model=_MODEL,
            contents=prompt,
            config=_discovery_config(),
        )
        context, context_type, fields = _parse_discovery_response(response)
        return DiscoveryResult(
            success=True,
            context=context,
            context_type=context_type,
            fields=fields,
            provider="gemini",
            model=_MODEL,
            mode="discovery",
        )
    except Exception as e:
        return DiscoveryResult(
            success=False,
            fields=[],
            provider="gemini",
            model=_MODEL,
            error=str(e),
            mode="discovery",
        )


async def discover_and_extract_multimodal(
    media_bytes: bytes,
    mime_type: str,
    transcript: str,
) -> DiscoveryResult:
    """Modo descoberta multimodal: combina imagem + texto transcrito (ou digitado).
    Usa as duas fontes juntas para produzir uma única estrutura de informação."""
    try:
        combined_prompt = (
            _DISCOVERY_PROMPT
            + f"\n\nCONTEÚDO DE ÁUDIO/TEXTO (transcrição ou texto digitado):\n{transcript}"
            + "\n\nALÉM DISSO, analise também a imagem enviada junto com esta mensagem."
            + "\nUse ambas as fontes para produzir os campos mais completos possíveis."
        )
        response = await _client.aio.models.generate_content(
            model=_MODEL,
            contents=[
                combined_prompt,
                types.Part.from_bytes(data=media_bytes, mime_type=mime_type),
            ],
            config=_discovery_config(),
        )
        context, context_type, fields = _parse_discovery_response(response)
        return DiscoveryResult(
            success=True,
            context=context,
            context_type=context_type,
            fields=fields,
            provider="gemini",
            model=_MODEL,
            mode="discovery",
        )
    except Exception as e:
        return DiscoveryResult(
            success=False,
            fields=[],
            provider="gemini",
            model=_MODEL,
            error=str(e),
            mode="discovery",
        )


# ─── MODO AUTOMÁTICO (classifica contra templates existentes ou propõe um novo) ─
# Usado pelo endpoint POST /extract/auto. Numa única chamada, a IA decide se
# a captura se encaixa em algum form_template já cadastrado (devolvendo só o
# id + eventuais campos que faltavam nele) ou se nenhum serve e um template
# novo deve ser proposto — e já extrai os valores encontrados.

_AUTO_PROMPT = """Você é um assistente que recebe uma captura de campo (foto e/ou texto — que pode ser transcrição de áudio ou digitado) e decide como estruturá-la dentro de um sistema de formulários dinâmico.

FORMULÁRIOS JÁ CADASTRADOS (catálogo, em JSON):
{catalog_json}

SEU TRABALHO, EM UMA ÚNICA RESPOSTA:
1. Decida se o conteúdo se encaixa em algum formulário do catálogo acima (match="existing") ou se nenhum deles serve e um formulário novo precisa ser criado (match="new"). Prefira reaproveitar um formulário existente sempre que o conteúdo for do mesmo tipo, mesmo que falte algum campo.
2. Se match="existing": preencha "template_id" com o id exato do formulário escolhido (copiado do catálogo). Se esse formulário não tiver algum campo essencial para o conteúdo (ex.: uma nota fiscal sem campo "emissor"), liste esse(s) campo(s) em "suggested_fields" no mesmo formato dos campos do catálogo — isso NÃO é motivo para propor um formulário novo. Deixe "new_template" com name="" e fields=[].
3. Se match="new": preencha "new_template" com nome, descrição, has_items e os campos propostos. Deixe "template_id"="" e "suggested_fields"=[].
4. Em "fields", extraia os valores encontrados no conteúdo para os campos de nível de relatório (do template escolhido + suggested_fields, ou do novo template) — apenas os que NÃO são is_item_field.
5. Se o formulário (existente ou novo) tiver has_items=true, retorne também "items": uma lista onde cada item tem seus próprios "fields", contendo só os campos marcados is_item_field. Se has_items=false, retorne "items": [].

REGRAS:
- Nunca invente informações que não estão no conteúdo.
- Para valores não encontrados, use string vazia "".
- confidence reflete sua certeza: 1.0 = certeza absoluta, 0.5 = incerto.
- "source" de cada campo extraído indica de onde veio o valor predominantemente: "image", "audio", "text", ou "" se não fizer sentido diferenciar.
- Tipos válidos para campos: text, long_text, number, decimal, date, boolean, select.
- Chaves (key) em snake_case, sem espaços. Rótulos (label) em português, claros para um usuário leigo.
- Retorne APENAS o JSON pedido, sem texto adicional.
"""

_AUTO_FIELD_SPEC_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "key": {"type": "STRING"},
        "label": {"type": "STRING"},
        "type": {"type": "STRING"},
        "extraction_hint": {"type": "STRING"},
        "options": {"type": "ARRAY", "items": {"type": "STRING"}},
        "is_item_field": {"type": "BOOLEAN"},
    },
    "required": ["key", "label", "type"],
}

_AUTO_EXTRACTED_FIELD_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "key": {"type": "STRING"},
        "value": {"type": "STRING"},
        "confidence": {"type": "NUMBER"},
        "source": {"type": "STRING"},
    },
    "required": ["key", "value", "confidence"],
}

_AUTO_RESPONSE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "match": {"type": "STRING"},
        "template_id": {"type": "STRING"},
        "new_template": {
            "type": "OBJECT",
            "properties": {
                "name": {"type": "STRING"},
                "description": {"type": "STRING"},
                "has_items": {"type": "BOOLEAN"},
                "fields": {"type": "ARRAY", "items": _AUTO_FIELD_SPEC_SCHEMA},
            },
            "required": ["name", "fields"],
        },
        "suggested_fields": {"type": "ARRAY", "items": _AUTO_FIELD_SPEC_SCHEMA},
        "fields": {"type": "ARRAY", "items": _AUTO_EXTRACTED_FIELD_SCHEMA},
        "items": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {"fields": {"type": "ARRAY", "items": _AUTO_EXTRACTED_FIELD_SCHEMA}},
                "required": ["fields"],
            },
        },
    },
    "required": ["match", "template_id", "new_template", "suggested_fields", "fields", "items"],
}


def _auto_config() -> types.GenerateContentConfig:
    return types.GenerateContentConfig(
        response_mime_type="application/json",
        response_schema=_AUTO_RESPONSE_SCHEMA,
    )


async def classify_and_extract(
    catalog: list[dict],
    photos: list[tuple[bytes, str]],
    text: str | None,
) -> dict:
    """Classifica a captura contra o catálogo de formulários (ou propõe um
    novo) e já extrai os valores encontrados — tudo numa única chamada.
    Retorna o dict cru (ver _AUTO_RESPONSE_SCHEMA); quem chama
    (routes/extract.py) decide o que fazer no banco a partir dele."""
    prompt = _AUTO_PROMPT.format(catalog_json=json.dumps(catalog, ensure_ascii=False))
    if text:
        prompt += f"\n\nCONTEÚDO DE ÁUDIO/TEXTO (transcrição ou texto digitado):\n{text}"
    if photos:
        prompt += "\n\nALÉM DISSO, analise a(s) imagem(ns) enviada(s) junto com esta mensagem."

    contents: list = [prompt]
    for media_bytes, mime_type in photos:
        contents.append(types.Part.from_bytes(data=media_bytes, mime_type=mime_type))

    response = await _client.aio.models.generate_content(
        model=_MODEL,
        contents=contents,
        config=_auto_config(),
    )
    return json.loads(response.text)
