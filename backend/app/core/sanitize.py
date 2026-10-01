# backend/app/core/sanitize.py
"""Sanitização e validação centralizadas de tudo que entra no backend.

Dois tipos de entrada passam por aqui:
  - dados do app (formulários, relatórios, textos digitados): limites
    ESTRITOS — valor fora do limite vira 422, nada é cortado em silêncio;
  - saída da IA (Gemini/Whisper): limites TOLERANTES — a resposta é
    normalizada (truncada, chave em snake_case, confiança entre 0 e 1) em vez
    de derrubar a extração inteira por causa de um campo mal formado.

Os limites em LIMITS espelham src/utils/sanitize.ts (LIMITS) no app — se
mudar aqui, mude lá também.

Este módulo NÃO importa settings/supabase de propósito: é puro e testável
sem variáveis de ambiente.
"""
import math
import re
import unicodedata
import uuid as uuid_lib
from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import Path
from pydantic import AfterValidator, BeforeValidator

# ─── limites (espelham LIMITS em src/utils/sanitize.ts) ────────────────────
MAX_NAME = 120            # nome de formulário, label de campo
MAX_DESCRIPTION = 500     # descrição de formulário/campo, extraction_hint
MAX_KEY = 64              # key (snake_case) de campo
MAX_OPTION = 100          # uma opção de select/multiselect
MAX_OPTIONS = 50          # opções por campo
MAX_CONTEXT = 200         # context_label, form_template_name
MAX_FIELD_VALUE = 10_000  # valor textual de um campo
MAX_USER_TEXT = 10_000    # texto digitado / transcrição enviados à IA
MAX_CUSTOM_INSTRUCTION = 500
MAX_LOCAL_PATH = 500
MAX_URL = 2048
MAX_NUMBER = 1e15         # |número| máximo aceito (evita overflow/precisão)

FIELD_TYPES = ("text", "long_text", "number", "decimal",
               "date", "boolean", "select", "multiselect")
FieldType = Literal["text", "long_text", "number", "decimal",
                    "date", "boolean", "select", "multiselect"]
InputSource = Literal["image", "audio", "text", "combined", "manual"]
AI_SOURCES = ("image", "audio", "text")

# Caracteres de controle (exceto \t \n \r) e "invisíveis" perigosos: BOM,
# zero-width space e as marcas bidi (U+202A–202E / U+2066–2069) usadas para
# esconder ou inverter texto ("Trojan Source"). ZWJ/ZWNJ ficam: emojis
# compostos dependem deles.
_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]")
_INVISIBLE_RE = re.compile("[\u200b\u2060\ufeff\u202a-\u202e\u2066-\u2069]")
_WS_RE = re.compile(r"\s+")
_MULTI_NL_RE = re.compile(r"\n{3,}")

_UUID_PATTERN = (
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


# ─── texto ─────────────────────────────────────────────────────────────────

def clean_text(
    value: Any,
    max_len: int,
    *,
    multiline: bool = False,
    truncate: bool = False,
    required: bool = False,
) -> str:
    """Normaliza (NFC), remove caracteres de controle/invisíveis e apara.

    multiline=False colapsa qualquer espaço/quebra de linha em um espaço.
    truncate=False levanta ValueError se passar de max_len (entrada do app);
    truncate=True corta (saída da IA).
    """
    if not isinstance(value, str):
        raise ValueError("deve ser um texto")
    text = unicodedata.normalize("NFC", value)
    text = _CONTROL_RE.sub("", _INVISIBLE_RE.sub("", text.replace("\x00", "")))
    if multiline:
        text = text.replace("\r\n", "\n").replace("\r", "\n")
        text = _MULTI_NL_RE.sub("\n\n", text).strip()
    else:
        text = _WS_RE.sub(" ", text).strip()
    if len(text) > max_len:
        if not truncate:
            raise ValueError(f"máximo de {max_len} caracteres")
        text = text[:max_len].rstrip()
    if required and not text:
        raise ValueError("não pode ficar vazio")
    return text


def short_text(
    max_len: int,
    *,
    multiline: bool = False,
    truncate: bool = False,
    required: bool = False,
):
    """Fábrica de tipo Annotated[str, ...] com clean_text aplicado."""
    def _validate(value: str) -> str:
        return clean_text(
            value, max_len, multiline=multiline, truncate=truncate, required=required,
        )
    return Annotated[str, AfterValidator(_validate)]


# ─── keys (snake_case) ─────────────────────────────────────────────────────

def slugify_key(value: Any, max_len: int = MAX_KEY) -> str:
    """'Nº da Nota Fiscal' -> 'no_da_nota_fiscal'. Vazio se nada sobrar."""
    if not isinstance(value, str):
        return ""
    ascii_text = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9]+", "_", ascii_text.lower()).strip("_")
    return slug[:max_len].strip("_")


def _strict_slug(value: str) -> str:
    slug = slugify_key(value)
    if not slug:
        raise ValueError("a key precisa ter ao menos uma letra ou número")
    return slug


def _lenient_slug(value: Any) -> str:
    return slugify_key(value) or "campo"


def dedupe_keys(items: list, attr: str = "key") -> None:
    """Garante keys únicas numa lista de objetos (sufixo _2, _3...).
    O app usa a key como identidade do campo na tela de revisão."""
    seen: set[str] = set()
    for item in items:
        base = getattr(item, attr)
        candidate, n = base, 2
        while candidate in seen:
            suffix = f"_{n}"
            candidate = f"{base[:MAX_KEY - len(suffix)]}{suffix}"
            n += 1
        seen.add(candidate)
        if candidate != base:
            setattr(item, attr, candidate)


# key nova (criação de formulário/campo): vira snake_case ou é rejeitada
SlugKey = Annotated[str, AfterValidator(_strict_slug)]
# key vinda da IA / de relatório: nunca rejeita, cai em "campo"
LenientKey = Annotated[str, BeforeValidator(_lenient_slug)]
# context_type do relatório: slug ou None (nunca "campo" para vazio)
ContextType = Annotated[
    str | None,
    BeforeValidator(lambda v: (slugify_key(v) or None) if isinstance(v, str) else v),
]
# key ecoada de um template existente: NÃO reescreve (chaves antigas podem
# não ser snake_case e precisam casar exatamente com o que o app enviou)
EchoKey = short_text(MAX_KEY, truncate=True, required=True)


# ─── ids, datas, números ───────────────────────────────────────────────────

def validate_uuid(value: str) -> str:
    try:
        return str(uuid_lib.UUID(str(value).strip()))
    except (ValueError, AttributeError, TypeError):
        raise ValueError("não é um UUID válido")


def is_valid_uuid(value: Any) -> bool:
    try:
        validate_uuid(value)
        return True
    except ValueError:
        return False


UUIDStr = Annotated[str, AfterValidator(validate_uuid)]
# id em path de rota: 422 já na entrada, antes de qualquer consulta
PathUUID = Annotated[str, Path(pattern=_UUID_PATTERN, max_length=36)]


def validate_iso_datetime(value: str) -> str:
    try:
        datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        raise ValueError("data/hora inválida (use ISO 8601)")
    return value.strip()


IsoDateTime = Annotated[str, AfterValidator(validate_iso_datetime)]


def _clamp01(value: Any) -> float:
    """Confiança vinda da IA: força para [0, 1] em vez de estourar 422."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    if math.isnan(number):
        return 0.0
    return max(0.0, min(1.0, number))


AiConfidence = Annotated[float, BeforeValidator(_clamp01)]


def _coerce_ai_type(value: Any) -> str:
    return value if value in FIELD_TYPES else "text"


def _coerce_ai_source(value: Any) -> str | None:
    # A IA devolve "" quando não sabe — e "" quebraria o CHECK de
    # report_fields.input_source no banco.
    return value if value in AI_SOURCES else None


AiFieldType = Annotated[str, BeforeValidator(_coerce_ai_type)]
# igual, mas None continua None (relatórios antigos guardam tipo qualquer)
OptionalAiFieldType = Annotated[
    str | None, BeforeValidator(lambda v: None if v is None else _coerce_ai_type(v)),
]
AiSource = Annotated[str | None, BeforeValidator(_coerce_ai_source)]


# ─── listas / regex ────────────────────────────────────────────────────────

def clean_options(values: list[str]) -> list[str]:
    if len(values) > MAX_OPTIONS:
        raise ValueError(f"máximo de {MAX_OPTIONS} opções")
    seen: dict[str, None] = {}
    for raw in values:
        option = clean_text(raw, MAX_OPTION)
        if option:
            seen.setdefault(option, None)
    return list(seen)


OptionList = Annotated[list[str], AfterValidator(clean_options)]


def validate_regex(value: str) -> str:
    """pattern de validation_rules. Hoje só é guardado; limitar tamanho e
    exigir que compile evita lixo e reduz risco de ReDoS se o app passar a
    aplicá-lo (RegExp no JS)."""
    pattern = clean_text(value, 200)
    try:
        re.compile(pattern)
    except re.error:
        raise ValueError("expressão regular inválida")
    return pattern


RegexPattern = Annotated[str, AfterValidator(validate_regex)]


# ─── valor tipado de um campo de relatório ─────────────────────────────────

def validate_field_value(fv: dict) -> dict:
    """Valida o FieldValue (union discriminada do app) e devolve só
    {type, value}, com o valor no tipo certo para a coluna do banco."""
    field_type = fv.get("type")
    value = fv.get("value")
    if field_type not in FIELD_TYPES:
        raise ValueError(f"tipo de valor desconhecido: {str(field_type)[:30]!r}")

    if value is None:
        return {"type": field_type, "value": [] if field_type == "multiselect" else None}

    if field_type in ("text", "long_text", "select"):
        return {"type": field_type,
                "value": clean_text(value, MAX_FIELD_VALUE, multiline=True)}

    if field_type in ("number", "decimal"):
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError("valor numérico inválido")
        if not math.isfinite(value) or abs(value) > MAX_NUMBER:
            raise ValueError("valor numérico fora do limite")
        return {"type": field_type, "value": value}

    if field_type == "boolean":
        if not isinstance(value, bool):
            raise ValueError("valor booleano inválido")
        return {"type": field_type, "value": value}

    if field_type == "date":
        # Formato é normalizado na rota (normalize_date) — aqui só higiene.
        return {"type": field_type, "value": clean_text(value, 40)}

    # multiselect
    if not isinstance(value, list):
        raise ValueError("multiselect precisa ser uma lista")
    return {"type": field_type, "value": clean_options(value)}


FieldValueIn = Annotated[dict[str, Any], AfterValidator(validate_field_value)]


# ─── datas de campo ────────────────────────────────────────────────────────
# ISO primeiro; DD/MM/YYYY porque o Gemini às vezes devolve no formato
# brasileiro mesmo pedindo YYYY-MM-DD, e a coluna DATE não aceita isso.
_DATE_FORMATS = ("%Y-%m-%d", "%d/%m/%Y")


def normalize_date(value: str | None) -> str | None:
    """Devolve a data em ISO ou None se não reconhecer (a rota preserva o
    texto original em value_text para não perder a informação)."""
    if not value:
        return None
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(value, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


# ─── campos sugeridos pela IA (gravados em form_fields) ────────────────────

def sanitize_suggested_field(raw: dict) -> dict | None:
    """Normaliza um campo proposto pela IA antes de gravar em form_fields.
    Devolve None se não houver key/label aproveitável."""
    if not isinstance(raw, dict):
        return None
    key = slugify_key(raw.get("key"))
    label = clean_text(raw.get("label") or raw.get("key") or "", MAX_NAME, truncate=True)
    if not key or not label:
        return None
    hint = raw.get("extraction_hint")
    options = raw.get("options")
    return {
        "key": key,
        "label": label,
        "type": _coerce_ai_type(raw.get("type")),
        "extraction_hint": (
            clean_text(hint, MAX_DESCRIPTION, multiline=True, truncate=True) or None
            if isinstance(hint, str) else None
        ),
        "options": (
            list(dict.fromkeys(  # sem vazios nem repetidos, ordem preservada
                o for o in (clean_text(x, MAX_OPTION, truncate=True)
                            for x in options[:MAX_OPTIONS] if isinstance(x, str)) if o
            )) or None
            if isinstance(options, list) else None
        ),
        "is_item_field": bool(raw.get("is_item_field", False)),
    }