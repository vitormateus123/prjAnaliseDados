# backend/app/services/gemini_service.py
import json
from google import genai
from google.genai import types
from app.core.config import settings
from app.schemas.extraction import (
    ExtractedField,
    ExtractedItem,
    FieldHint,
    ClassificationResult,
    TemplateCatalogEntry,
)

_client = genai.Client(api_key=settings.gemini_api_key)

# O nome do modelo vem do .env (GEMINI_MODEL) justamente porque o Google
# aposenta modelos periodicamente — o gemini-2.0-flash-lite foi desligado em
# 01/06/2026 e passou a responder 404. Trocar de modelo não deve exigir deploy.
MODEL = settings.gemini_model
PROVIDER = "gemini"


class ExtractionError(Exception):
    """Falha ao obter uma resposta utilizável do modelo."""


# ─── extração clássica (template já escolhido, sem itens) ─────────────────

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


_FIELDS_SCHEMA = {
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


def _parse_fields_response(response) -> list[ExtractedField]:
    raw = getattr(response, "text", None)
    if not raw:
        raise ExtractionError(
            "O modelo não retornou conteúdo. Verifique se a imagem/áudio é legível."
        )
    try:
        data = json.loads(raw)
        return [ExtractedField(**f) for f in data["fields"]]
    except (json.JSONDecodeError, KeyError, TypeError) as err:
        raise ExtractionError(f"Resposta do modelo em formato inesperado: {err}") from err


async def extract_from_media(
    fields: list[FieldHint], media_bytes: bytes, mime_type: str,
) -> list[ExtractedField]:
    prompt = PROMPT_TEMPLATE.format(fields_spec=_build_fields_spec(fields))
    response = await _client.aio.models.generate_content(
        model=MODEL,
        contents=[prompt, types.Part.from_bytes(data=media_bytes, mime_type=mime_type)],
        config=types.GenerateContentConfig(
            response_mime_type="application/json", response_schema=_FIELDS_SCHEMA
        ),
    )
    return _parse_fields_response(response)


async def extract_from_text(fields: list[FieldHint], text: str) -> list[ExtractedField]:
    prompt = (
        PROMPT_TEMPLATE.format(fields_spec=_build_fields_spec(fields))
        + f"\n\nTEXTO TRANSCRITO (fala do usuário):\n{text}"
    )
    response = await _client.aio.models.generate_content(
        model=MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json", response_schema=_FIELDS_SCHEMA
        ),
    )
    return _parse_fields_response(response)


# ─── classificação: usar template existente ou propor um novo ─────────────

CLASSIFY_PROMPT_TEMPLATE = """Você analisa relatos de trabalhadores de campo (texto transcrito de voz, ou uma foto) e decide qual TIPO de formulário se aplica.

TEMPLATES DISPONÍVEIS:
{templates_spec}

Se um dos templates acima descrever bem o conteúdo, responda "existing" com o id dele.

Se NENHUM template existente descrever bem o conteúdo, responda "new" e proponha um template:
- name: nome curto do tipo de formulário (ex: "Registro de Manutenção")
- description: uma frase explicando o tipo de coleta
- has_items: true se o relato descreve MÚLTIPLOS itens/objetos do mesmo tipo repetidos (ex: uma foto com vários produtos numa prateleira/despensa, uma lista de itens contados um a um) — false se é um único registro (ex: um documento, uma inspeção de um único local)
- fields: até 8 campos a extrair. Para cada campo:
  - key: snake_case, sem acentos
  - label: rótulo para exibir ao usuário
  - type: um de text, long_text, number, decimal, date, boolean, select, multiselect
  - extraction_hint: instrução curta para outra IA extrair esse valor do conteúdo
  - options: lista de opções, apenas se type for select ou multiselect
  - is_item_field: true se esse campo se repete por item (só faz sentido quando has_items=true, ex: "produto", "quantidade"); false se é um campo único do relatório inteiro (ex: "local", "data", "responsavel")

REGRAS:
- Prefira sempre um template existente se ele cobrir razoavelmente o conteúdo, mesmo que não seja perfeito — evite propor um template novo para algo que já existe com outro nome.
- has_items é uma restrição rígida do template, não uma sugestão: um template com has_items=false só pode representar UM registro. Se o conteúdo mostrar vários itens do mesmo tipo repetidos (ex: vários produtos numa prateleira/despensa) e o template mais parecido tiver has_items=false, NÃO escolha esse template — proponha um novo com has_items=true, mesmo que o nome/propósito seja parecido com um já existente.
- Só proponha um template novo se realmente não há nenhum adequado (considerando também a restrição de has_items acima).
- Retorne APENAS o JSON pedido, sem texto adicional.
"""


def _build_templates_spec(catalog: list[TemplateCatalogEntry]) -> str:
    if not catalog:
        return "(nenhum template cadastrado ainda — proponha um novo)"
    lines = []
    for t in catalog:
        fields_desc = ", ".join(f"{f.key} ({f.type})" for f in t.fields) or "(sem campos)"
        lines.append(
            f'- id="{t.id}" | "{t.name}": {t.description or "sem descrição"} '
            f"| has_items={t.has_items} | campos: {fields_desc}"
        )
    return "\n".join(lines)


_CLASSIFY_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "match": {"type": "STRING", "enum": ["existing", "new"]},
        "template_id": {"type": "STRING"},
        "new_template": {
            "type": "OBJECT",
            "properties": {
                "name": {"type": "STRING"},
                "description": {"type": "STRING"},
                "has_items": {"type": "BOOLEAN"},
                "fields": {
                    "type": "ARRAY",
                    "items": {
                        "type": "OBJECT",
                        "properties": {
                            "key": {"type": "STRING"},
                            "label": {"type": "STRING"},
                            "type": {
                                "type": "STRING",
                                "enum": [
                                    "text", "long_text", "number", "decimal",
                                    "date", "boolean", "select", "multiselect",
                                ],
                            },
                            "extraction_hint": {"type": "STRING"},
                            "options": {"type": "ARRAY", "items": {"type": "STRING"}},
                            "is_item_field": {"type": "BOOLEAN"},
                        },
                        "required": ["key", "label", "type", "is_item_field"],
                    },
                },
            },
            "required": ["name", "has_items", "fields"],
        },
    },
    "required": ["match"],
}


async def classify_or_propose(
    catalog: list[TemplateCatalogEntry],
    *,
    text: str | None = None,
    media_bytes: bytes | None = None,
    mime_type: str | None = None,
) -> ClassificationResult:
    """Decide qual template usar, ou propõe um novo quando nada se encaixa.
    Passe `text` (voz já transcrita) OU `media_bytes`+`mime_type` (foto)."""
    prompt = CLASSIFY_PROMPT_TEMPLATE.format(templates_spec=_build_templates_spec(catalog))

    if text is not None:
        contents = prompt + f"\n\nTEXTO TRANSCRITO (fala do usuário):\n{text}"
    elif media_bytes is not None:
        contents = [prompt, types.Part.from_bytes(data=media_bytes, mime_type=mime_type)]
    else:
        raise ValueError("Forneça text ou media_bytes.")

    response = await _client.aio.models.generate_content(
        model=MODEL,
        contents=contents,
        config=types.GenerateContentConfig(
            response_mime_type="application/json", response_schema=_CLASSIFY_SCHEMA
        ),
    )
    raw = getattr(response, "text", None)
    if not raw:
        raise ExtractionError("O modelo não retornou uma classificação.")
    try:
        return ClassificationResult(**json.loads(raw))
    except (json.JSONDecodeError, TypeError) as err:
        raise ExtractionError(f"Resposta de classificação em formato inesperado: {err}") from err


# ─── extração para um template que pode ter itens repetidos ───────────────

ITEMS_PROMPT_TEMPLATE = """Você extrai informações estruturadas de relatos de trabalhadores de campo (voz ou foto), incluindo casos com MÚLTIPLOS itens do mesmo tipo (ex: vários produtos numa foto de prateleira/despensa).

CAMPOS DE NÍVEL DE RELATÓRIO (extraia uma vez só, se presentes):
{flat_spec}

CAMPOS POR ITEM (identifique CADA item distinto no conteúdo e extraia estes campos para cada um):
{item_spec}

REGRAS:
- Identifique quantos itens distintos existem no conteúdo (ex: conte cada produto visível na foto).
- Extraia os campos por item para CADA item encontrado — não agrupe itens diferentes numa linha só.
- Para campos não encontrados, retorne string vazia "".
- Retorne APENAS o JSON pedido, sem texto adicional.

Retorne um JSON com esta estrutura exata:
{{
  "fields": [{{"key": "chave", "value": "valor", "confidence": 0.9}}],
  "items": [
    {{"fields": [{{"key": "chave_do_item", "value": "valor", "confidence": 0.9}}]}}
  ]
}}
"""


_ITEMS_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "fields": _FIELDS_SCHEMA["properties"]["fields"],
        "items": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {"fields": _FIELDS_SCHEMA["properties"]["fields"]},
                "required": ["fields"],
            },
        },
    },
    "required": ["fields", "items"],
}


def _parse_items_response(response) -> tuple[list[ExtractedField], list[ExtractedItem]]:
    raw = getattr(response, "text", None)
    if not raw:
        raise ExtractionError(
            "O modelo não retornou conteúdo. Verifique se a imagem/áudio é legível."
        )
    try:
        data = json.loads(raw)
        flat = [ExtractedField(**f) for f in data["fields"]]
        items = [
            ExtractedItem(fields=[ExtractedField(**f) for f in it["fields"]])
            for it in data["items"]
        ]
        return flat, items
    except (json.JSONDecodeError, KeyError, TypeError) as err:
        raise ExtractionError(f"Resposta do modelo em formato inesperado: {err}") from err


async def extract_for_template(
    fields: list[FieldHint],
    has_items: bool,
    *,
    text: str | None = None,
    media_bytes: bytes | None = None,
    mime_type: str | None = None,
) -> tuple[list[ExtractedField], list[ExtractedItem]]:
    """Extrai os valores para um template já resolvido (existente ou recém-criado).
    Retorna (campos_de_nivel_de_relatorio, itens) — `itens` fica vazio quando
    has_items=False."""
    if not has_items:
        if text is not None:
            flat = await extract_from_text(fields, text)
        elif media_bytes is not None:
            flat = await extract_from_media(fields, media_bytes, mime_type)
        else:
            raise ValueError("Forneça text ou media_bytes.")
        return flat, []

    flat_fields = [f for f in fields if not f.is_item_field]
    item_fields = [f for f in fields if f.is_item_field]
    prompt = ITEMS_PROMPT_TEMPLATE.format(
        flat_spec=_build_fields_spec(flat_fields) or "(nenhum)",
        item_spec=_build_fields_spec(item_fields) or "(nenhum)",
    )

    if text is not None:
        contents = prompt + f"\n\nTEXTO TRANSCRITO (fala do usuário):\n{text}"
    elif media_bytes is not None:
        contents = [prompt, types.Part.from_bytes(data=media_bytes, mime_type=mime_type)]
    else:
        raise ValueError("Forneça text ou media_bytes.")

    response = await _client.aio.models.generate_content(
        model=MODEL,
        contents=contents,
        config=types.GenerateContentConfig(
            response_mime_type="application/json", response_schema=_ITEMS_SCHEMA
        ),
    )
    return _parse_items_response(response)