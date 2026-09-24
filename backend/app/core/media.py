# backend/app/core/media.py
"""Validação de mídia recebida (fotos/áudio) e de referências ao Storage.

Um só lugar para o que antes estava repetido em extract.py (3 cópias da
checagem de tamanho/MIME) e reports.py (upload de captures):
  - decodificação base64 estrita, com limite de tamanho ANTES de decodificar;
  - o tipo real do arquivo vem dos "magic bytes", não do MIME declarado pelo
    cliente (que é só uma alegação);
  - URLs de arquivo só são aceitas se apontarem para o Storage do próprio
    projeto Supabase (evita SSRF em /extract/refine).
Puro (sem settings): recebe supabase_url por parâmetro.
"""
import base64
import binascii
import re
from typing import Literal
from urllib.parse import unquote, urlparse

MAX_MEDIA_BYTES = 10 * 1024 * 1024  # 10 MB por arquivo
# tamanho máximo do base64 de um arquivo de 10 MB (4 chars por 3 bytes) + folga
MAX_BASE64_CHARS = (MAX_MEDIA_BYTES * 4) // 3 + 16
MAX_PHOTOS = 8  # fotos por captura (o app limita a 6)

Kind = Literal["image", "audio"]

MIME_EXTENSIONS = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif",
    "audio/m4a": "m4a",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/ogg": "ogg",
    "audio/webm": "webm",
    "audio/flac": "flac",
}

_HEIC_BRANDS = {b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis"}
_HEIF_BRANDS = {b"mif1", b"msf1"}


class MediaError(ValueError):
    """Mídia inválida. status_code é o HTTP sugerido para a rota."""

    def __init__(self, message: str, status_code: int = 422):
        super().__init__(message)
        self.status_code = status_code


def sniff_mime(data: bytes) -> str | None:
    """Tipo real do arquivo pelos primeiros bytes; None se não reconhecer."""
    head = data[:16]
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    if head[:4] == b"RIFF" and head[8:12] == b"WAVE":
        return "audio/wav"
    if head[4:8] == b"ftyp":
        brand = head[8:12]
        if brand in _HEIC_BRANDS:
            return "image/heic"
        if brand in _HEIF_BRANDS:
            return "image/heif"
        return "audio/m4a"  # mp4/m4a/3gp — o Whisper aceita o container
    if head.startswith(b"ID3") or (len(head) > 1 and head[0] == 0xFF and head[1] & 0xE0 == 0xE0):
        return "audio/mpeg"
    if head.startswith(b"OggS"):
        return "audio/ogg"
    if head.startswith(b"\x1a\x45\xdf\xa3"):
        return "audio/webm"
    if head.startswith(b"fLaC"):
        return "audio/flac"
    return None


def validate_media_bytes(data: bytes, kind: Kind) -> str:
    """Confere tamanho e assinatura; devolve o MIME REAL do arquivo."""
    if not data:
        raise MediaError("Arquivo vazio.")
    if len(data) > MAX_MEDIA_BYTES:
        raise MediaError("Arquivo muito grande (máx. 10 MB).", 413)
    mime = sniff_mime(data)
    if mime is None or not mime.startswith(f"{kind}/"):
        label = "imagem" if kind == "image" else "áudio"
        raise MediaError(f"O arquivo enviado não é uma {label} suportada.", 415)
    return mime


def decode_base64_media(data_b64: str, kind: Kind) -> tuple[bytes, str]:
    """base64 -> (bytes, mime real). Limite checado antes de decodificar."""
    compact = "".join(data_b64.split())  # alguns encoders quebram linhas
    if len(compact) > MAX_BASE64_CHARS:
        raise MediaError("Arquivo muito grande (máx. 10 MB).", 413)
    try:
        raw = base64.b64decode(compact, validate=True)
    except (binascii.Error, ValueError):
        raise MediaError("Conteúdo do arquivo (base64) inválido.")
    return raw, validate_media_bytes(raw, kind)


# ─── referências ao Storage ────────────────────────────────────────────────

_STORAGE_PATH_RE = re.compile(
    r"^(?P<report>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/"
    r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{2,5}$"
)


def storage_path_from_signed_url(url: str, supabase_url: str, bucket: str) -> str | None:
    """Extrai o caminho de uma signed URL do Storage do NOSSO projeto.

    Devolve None para qualquer outra URL (outro host, outra porta, userinfo,
    outro bucket, path traversal). É o que impede o backend de virar proxy
    para endereços internos ou arbitrários."""
    try:
        parsed, base = urlparse(url), urlparse(supabase_url)
        if (
            parsed.scheme != base.scheme
            or parsed.scheme not in ("https", "http")
            or not parsed.hostname
            or parsed.hostname.lower() != (base.hostname or "").lower()
            or parsed.port != base.port
            or parsed.username is not None
            or parsed.password is not None
        ):
            return None
        prefix = f"/storage/v1/object/sign/{bucket}/"
        if not parsed.path.startswith(prefix):
            return None
        path = unquote(parsed.path[len(prefix):])
    except ValueError:
        return None
    if not path or ".." in path or "\\" in path or path.startswith("/"):
        return None
    return path


def safe_capture_path(file_ref: str | None, report_id: str, supabase_url: str, bucket: str) -> str | None:
    """Normaliza o file_url que o app manda numa capture.

    Aceita (a) o caminho '<report_id>/<capture_id>.<ext>' que nós mesmos
    gravamos ou (b) uma signed URL do nosso Storage (o app guarda a URL que
    recebeu na leitura) — convertida de volta para o caminho. Só vale se o
    caminho pertence a ESTE relatório; qualquer outra coisa vira None."""
    if not file_ref:
        return None
    ref = file_ref.strip()
    if ref.lower().startswith(("http://", "https://")):
        ref = storage_path_from_signed_url(ref, supabase_url, bucket) or ""
    match = _STORAGE_PATH_RE.match(ref.lower())
    if not match or match.group("report") != report_id.lower():
        return None
    return ref.lower()