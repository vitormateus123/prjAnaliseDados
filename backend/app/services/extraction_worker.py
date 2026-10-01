# backend/app/services/extraction_worker.py
"""Worker de extração offline — roda SÓ no servidor.

Fluxo: o usuário captura sem internet → o app guarda a captura e, quando a
conexão volta (mesmo com o app fechado, via tarefa em segundo plano), envia o
relatório com extraction_status='pending' (POST /reports/). Este worker
(GitHub Actions / Fly Machine / APScheduler, ver worker_runner.py e main.py)
pega os relatórios 'pending', extrai com a IA, grava os campos e avisa o
usuário por push (Expo). O app busca o resultado depois (GET /reports/).

Garantias:
  - claim atômico: pending → processing é um UPDATE condicional, então dois
    workers (ou duas execuções) nunca extraem o mesmo relatório;
  - 'processing' travado (worker morto) volta para 'pending' após
    STALE_PROCESSING; cada claim conta uma tentativa (MAX_ATTEMPTS);
  - só lê mídia do Storage em caminhos que pertencem ao próprio relatório
    (safe_capture_path) e confere o tipo real pelos magic bytes.
"""
import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone

import httpx

from app.api.routes.reports import _CAPTURES_BUCKET, _field_value_to_columns
from app.api.routes.templates import FIELD_TYPES
from app.core.config import settings
from app.core.errors import public_ai_error
from app.core.media import MediaError, safe_capture_path, validate_media_bytes
from app.schemas.extraction import EXTRACTION_PURPOSES, FieldHint
from app.services import gemini_service
from app.services.groq_service import transcribe_audio
from app.services.supabase_service import get_admin_client
from app.services.template_catalog import fetch_template_catalog

logger = logging.getLogger("extraction_worker")

# Estados de extração (espelha migration 0014)
EXTRACTION_PENDING = "pending"
EXTRACTION_PROCESSING = "processing"
EXTRACTION_DONE = "done"
EXTRACTION_FAILED = "failed"

MAX_ATTEMPTS = 3
STALE_PROCESSING = timedelta(minutes=10)  # worker que morreu no meio da extração
AI_TIMEOUT_SECONDS = 120
_EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
_VALID_INPUT_SOURCES = {"image", "audio", "text"}


class ExtractionSuperseded(Exception):
    """O relatório mudou de estado durante a extração (ex.: o usuário preencheu
    manualmente e o app mandou extraction_status='not_applicable'). O resultado
    da IA é descartado — nunca sobrescreve o que a pessoa digitou."""


# ─── valores ───────────────────────────────────────────────────────────────

def _parse_value(field_type: str, raw: str) -> dict:
    """Texto devolvido pela IA → FieldValue tipado (espelha parseFieldValue em
    src/utils/fieldValue.ts)."""
    text = (raw or "").strip()
    if field_type in ("number", "decimal"):
        try:
            normalized = text.replace(",", ".")
            value = None if not text else (
                int(float(normalized)) if field_type == "number" else float(normalized)
            )
        except ValueError:
            value = None
        return {"type": field_type, "value": value}
    if field_type == "boolean":
        lowered = text.lower()
        value = (
            True if lowered in ("sim", "true", "verdadeiro", "1")
            else False if lowered in ("não", "nao", "false", "falso", "0")
            else None
        )
        return {"type": "boolean", "value": value}
    if field_type == "date":
        return {"type": "date", "value": text or None}
    if field_type == "select":
        return {"type": "select", "value": text or None}
    if field_type == "multiselect":
        return {"type": "multiselect", "value": [v.strip() for v in text.split(",") if v.strip()]}
    return {"type": field_type, "value": raw}


def _field_row(
    owner: dict,
    *,
    key: str,
    label: str,
    field_type: str,
    raw_value: str | None,
    confidence: float | None,
    source: str | None,
    form_field_id: str | None,
) -> dict | None:
    """Linha de report_fields/report_item_fields, ou None quando a IA não achou
    valor (campos vazios não são gravados — mesmo critério do app)."""
    if not (raw_value or "").strip():
        return None
    field_type = field_type if field_type in FIELD_TYPES else "text"
    columns = _field_value_to_columns(_parse_value(field_type, raw_value))
    if all(v in (None, []) for v in columns.values()):
        return None  # ex.: número que não deu para interpretar

    row = {
        **owner,
        "form_field_id": form_field_id,
        "confidence": None if confidence is None else max(0.0, min(1.0, float(confidence))),
        "source": "ai",
        "input_source": source if source in _VALID_INPUT_SOURCES else None,
        "was_edited": False,
        **columns,
    }
    if form_field_id is None:
        row.update({"dynamic_key": key, "dynamic_label": label, "dynamic_type": field_type})
    return row


# ─── acesso ao banco (síncrono; chamado via asyncio.to_thread) ────────────

def _release_stale_processing(db) -> None:
    cutoff = (datetime.now(timezone.utc) - STALE_PROCESSING).isoformat()
    db.table("reports").update({"extraction_status": EXTRACTION_PENDING}).eq(
        "extraction_status", EXTRACTION_PROCESSING
    ).lte("updated_at", cutoff).execute()


def _list_pending(db, limit: int) -> list[dict]:
    return (
        db.table("reports")
        .select("id,extraction_attempts")
        .eq("extraction_status", EXTRACTION_PENDING)
        .order("updated_at")
        .limit(limit)
        .execute()
        .data
    ) or []


def _claim(db, report_id: str, attempts: int) -> bool:
    """pending → processing, atômico. A condição em extraction_attempts impede
    que duas execuções peguem o mesmo relatório ao mesmo tempo."""
    resp = (
        db.table("reports")
        .update({"extraction_status": EXTRACTION_PROCESSING, "extraction_attempts": attempts + 1})
        .eq("id", report_id)
        .eq("extraction_status", EXTRACTION_PENDING)
        .eq("extraction_attempts", attempts)
        .execute()
    )
    return bool(resp.data)


def _mark_exhausted(db, report_id: str) -> bool:
    resp = (
        db.table("reports")
        .update({
            "extraction_status": EXTRACTION_FAILED,
            "extraction_last_error": "A extração falhou várias vezes. Preencha manualmente.",
        })
        .eq("id", report_id)
        .eq("extraction_status", EXTRACTION_PENDING)
        .execute()
    )
    return bool(resp.data)


def _finish_failure(db, report_id: str, message: str, final: bool) -> None:
    db.table("reports").update({
        "extraction_status": EXTRACTION_FAILED if final else EXTRACTION_PENDING,
        "extraction_last_error": message,
    }).eq("id", report_id).eq("extraction_status", EXTRACTION_PROCESSING).execute()


def _load_report(db, report_id: str) -> dict | None:
    rows = db.table("reports").select("*, captures(*)").eq("id", report_id).execute().data
    return rows[0] if rows else None


def _load_template(db, template_id: str) -> tuple[dict, list[dict]] | None:
    """(template, campos) de um formulário ATIVO, ou None."""
    templates = (
        db.table("form_templates").select("id,name,has_items")
        .eq("id", template_id).eq("active", True).execute().data
    )
    if not templates:
        return None
    fields = (
        db.table("form_fields").select("*")
        .eq("form_template_id", template_id).order("position").execute().data
    ) or []
    return templates[0], fields


def _download(db, path: str) -> bytes:
    return db.storage.from_(_CAPTURES_BUCKET).download(path)


def _save_transcript(db, capture_id: str, transcript: str) -> None:
    """A transcrição vive em captures.text_content da captura de voz (é de lá
    que o app a exibe e que o PDF a lê). Gravar já aqui também evita pagar o
    STT de novo se a extração falhar depois e for repetida."""
    db.table("captures").update({"text_content": transcript}).eq("id", capture_id).execute()


# ─── mídia do relatório ────────────────────────────────────────────────────

async def _resolve_media(db, report: dict) -> tuple[list[tuple[bytes, str]], str | None]:
    """Fotos (bytes, mime real) e o texto combinado (transcrições + digitado)."""
    photos: list[tuple[bytes, str]] = []
    transcripts: list[str] = []
    typed: list[str] = []

    for capture in report.get("captures") or []:
        ctype = capture.get("type")
        if ctype == "text":
            if (capture.get("text_content") or "").strip():
                typed.append(capture["text_content"].strip())
            continue
        if ctype not in ("photo", "voice"):
            continue

        if ctype == "voice" and (capture.get("text_content") or "").strip():
            transcripts.append(capture["text_content"].strip())  # já transcrita
            continue

        path = safe_capture_path(
            capture.get("file_url"), report["id"], settings.supabase_url, _CAPTURES_BUCKET
        )
        if not path:
            logger.warning("Capture %s sem arquivo válido no Storage; ignorada.", capture.get("id"))
            continue

        data = await asyncio.to_thread(_download, db, path)
        if ctype == "photo":
            photos.append((data, validate_media_bytes(data, "image")))
        else:
            mime = validate_media_bytes(data, "audio")
            # Falha de STT propaga: é transitória na maioria dos casos, e seguir
            # só com o resto da captura geraria um relatório incompleto "done".
            transcript = (await transcribe_audio(data, mime)).strip()
            transcripts.append(transcript)
            if transcript:
                await asyncio.to_thread(_save_transcript, db, capture["id"], transcript)

    parts = [t for t in transcripts if t]
    if typed:
        parts.append(("[Texto digitado adicional]:\n" if parts else "") + "\n\n".join(typed))
    return photos, ("\n\n".join(parts) or None)


# ─── IA ────────────────────────────────────────────────────────────────────

async def _run_ai(db, report: dict, photos, text) -> dict:
    """Devolve a estrutura pronta para gravar: com "template" (formulário
    existente: template_fields/fields/items) ou sem ele (dynamic_fields/
    dynamic_items + context_label/context_type)."""
    purpose = report.get("extraction_purpose")
    purpose = purpose if purpose in EXTRACTION_PURPOSES else None
    instruction = (report.get("extraction_custom_instruction") or "").strip() or None

    # Formulário já escolhido pelo usuário: extrai só os campos de nível de
    # relatório (como o app fazia); itens repetidos ficam para preenchimento manual.
    chosen_id = report.get("form_template_id")
    if chosen_id:
        loaded = await asyncio.to_thread(_load_template, db, chosen_id)
        if loaded:
            template, template_fields = loaded
            hints = [
                FieldHint(
                    key=f["key"], label=f["label"], type=f["type"],
                    extraction_hint=f.get("extraction_hint"),
                )
                for f in template_fields if not f.get("is_item_field")
            ]
            extracted = await asyncio.wait_for(
                gemini_service.refine_fields(hints, photos, text), AI_TIMEOUT_SECONDS
            )
            return {
                "template": template, "template_fields": template_fields,
                "fields": [e.model_dump() for e in extracted], "items": [],
            }
        logger.warning("Formulário %s não existe/está inativo; extraindo no modo automático.", chosen_id)

    # Modo automático: a IA classifica contra o catálogo ou estrutura livremente.
    catalog = await asyncio.to_thread(fetch_template_catalog, db)
    result = await asyncio.wait_for(
        gemini_service.classify_and_extract(catalog, photos, text, purpose, instruction),
        AI_TIMEOUT_SECONDS,
    )

    if result.get("match") == "existing" and result.get("template_id"):
        loaded = await asyncio.to_thread(_load_template, db, result["template_id"])
        if loaded:
            template, template_fields = loaded
            return {
                "template": template, "template_fields": template_fields,
                "fields": result.get("fields") or [],
                "items": (result.get("items") or []) if template.get("has_items") else [],
            }
        logger.warning("IA indicou formulário inexistente %s; usando estrutura dinâmica.", result.get("template_id"))

    if not result.get("dynamic_fields") and not result.get("dynamic_items"):
        raise ValueError("A IA não retornou nem um formulário válido nem uma estrutura dinâmica.")
    return {
        "template": None,
        "dynamic_fields": result.get("dynamic_fields") or [],
        "dynamic_items": result.get("dynamic_items") or [],
        "context_label": result.get("context_label") or "Informação organizada",
        "context_type": result.get("context_type") or "informacao",
    }


# ─── persistência ──────────────────────────────────────────────────────────

def _guided_rows(owner: dict, template_fields: list[dict], extracted: list[dict], *, items: bool) -> list[dict]:
    by_key = {f["key"]: f for f in template_fields if bool(f.get("is_item_field")) == items}
    rows = []
    for e in extracted:
        field = by_key.get(e.get("key"))
        if not field:
            continue
        row = _field_row(
            owner, key=field["key"], label=field["label"], field_type=field["type"],
            raw_value=e.get("value"), confidence=e.get("confidence"),
            source=e.get("source"), form_field_id=field["id"],
        )
        if row:
            rows.append(row)
    return rows


def _dynamic_rows(owner: dict, fields: list[dict]) -> list[dict]:
    rows = []
    for f in fields:
        key = f.get("key") or ""
        row = _field_row(
            owner, key=key, label=f.get("label") or key,
            field_type=f.get("type") or "text", raw_value=f.get("value"),
            confidence=f.get("confidence"), source=f.get("source"), form_field_id=None,
        )
        if row and key:
            rows.append(row)
    return rows


def _persist(db, report_id: str, structure: dict) -> str:
    """Grava campos/itens e fecha o relatório como 'done'. Idempotente: um retry
    apaga e regrava. Devolve o rótulo para a notificação."""
    current = db.table("reports").select("extraction_status").eq("id", report_id).execute().data
    if not current or current[0]["extraction_status"] != EXTRACTION_PROCESSING:
        raise ExtractionSuperseded(report_id)

    template = structure["template"]
    if template:
        template_fields = structure["template_fields"]
        field_rows = _guided_rows({"report_id": report_id}, template_fields, structure["fields"], items=False)
        item_rows = [
            _guided_rows({}, template_fields, item.get("fields") or [], items=True)
            for item in structure["items"]
        ]
        item_rows = [rows for rows in item_rows if rows]
        has_item_fields = any(f.get("is_item_field") for f in template_fields)
        if template.get("has_items") and has_item_fields and not item_rows:
            item_rows = [[]]  # um item vazio para preencher manualmente (como no app)
        report_update = {"form_template_id": template["id"], "context_label": template["name"]}
        label = template["name"]
    else:
        field_rows = _dynamic_rows({"report_id": report_id}, structure["dynamic_fields"])
        item_rows = [
            _dynamic_rows({}, item.get("fields") or []) for item in structure["dynamic_items"]
        ]
        item_rows = [rows for rows in item_rows if rows]
        report_update = {
            "form_template_id": None,
            "context_label": structure["context_label"],
            "context_type": structure["context_type"],
        }
        label = structure["context_label"]

    db.table("report_fields").delete().eq("report_id", report_id).execute()
    if field_rows:
        db.table("report_fields").insert(field_rows).execute()

    db.table("report_items").delete().eq("report_id", report_id).execute()  # cascade nos item_fields
    for position, rows in enumerate(item_rows):
        item_id = str(uuid.uuid4())
        db.table("report_items").insert(
            {"id": item_id, "report_id": report_id, "position": position}
        ).execute()
        if rows:
            db.table("report_item_fields").insert(
                [{**r, "report_item_id": item_id} for r in rows]
            ).execute()

    closed = (
        db.table("reports")
        .update({**report_update, "extraction_status": EXTRACTION_DONE, "extraction_last_error": None})
        .eq("id", report_id)
        .eq("extraction_status", EXTRACTION_PROCESSING)
        .execute()
    )
    if not closed.data:
        raise ExtractionSuperseded(report_id)
    return label


# ─── push ──────────────────────────────────────────────────────────────────

def _push_targets(db, report_id: str) -> tuple[list[str], str | None]:
    rows = db.table("reports").select("user_id,context_label").eq("id", report_id).execute().data
    if not rows or not rows[0].get("user_id"):
        return [], None
    tokens = (
        db.table("push_tokens").select("expo_push_token")
        .eq("user_id", rows[0]["user_id"]).eq("active", True).execute().data
    ) or []
    return [t["expo_push_token"] for t in tokens], rows[0].get("context_label")


def _deactivate_tokens(db, tokens: list[str]) -> None:
    db.table("push_tokens").update({"active": False}).in_("expo_push_token", tokens).execute()


async def _notify(db, report_id: str, *, failed: bool, label: str | None = None) -> None:
    """Best-effort: falha de push nunca desfaz uma extração concluída."""
    try:
        tokens, stored_label = await asyncio.to_thread(_push_targets, db, report_id)
        if not tokens:
            return
        label = label or stored_label or "Seu relatório"
        title = "Não foi possível extrair" if failed else "Extração concluída"
        body = (
            f"{label}: a IA não conseguiu extrair os dados. Abra para preencher manualmente."
            if failed else f"{label} está pronto para revisão."
        )
        messages = [{
            "to": token, "title": title, "body": body, "sound": "default", "priority": "high",
            "data": {
                "reportId": report_id,
                "type": "extraction_failed" if failed else "extraction_complete",
            },
        } for token in tokens]

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(_EXPO_PUSH_URL, json=messages)
        tickets = resp.json().get("data", []) if resp.status_code == 200 else []

        # Aparelho desinstalado/token revogado: para de tentar nesse token.
        dead = [
            token for token, ticket in zip(tokens, tickets)
            if ticket.get("status") == "error"
            and (ticket.get("details") or {}).get("error") == "DeviceNotRegistered"
        ]
        if dead:
            await asyncio.to_thread(_deactivate_tokens, db, dead)
    except Exception:
        logger.warning("Falha ao enviar push do relatório %s", report_id, exc_info=True)


# ─── orquestração ──────────────────────────────────────────────────────────

async def run_auto_extraction(report_id: str, attempts: int = 0) -> str:
    """Extrai um relatório 'pending'. Retorna 'done' | 'retry' | 'failed' | 'skipped'."""
    db = get_admin_client()

    if attempts >= MAX_ATTEMPTS:
        if await asyncio.to_thread(_mark_exhausted, db, report_id):
            await _notify(db, report_id, failed=True)
            return "failed"
        return "skipped"

    if not await asyncio.to_thread(_claim, db, report_id, attempts):
        return "skipped"  # outro worker pegou, ou o status mudou

    try:
        report = await asyncio.to_thread(_load_report, db, report_id)
        if not report:
            raise MediaError("Relatório não encontrado.")
        photos, text = await _resolve_media(db, report)
        if not photos and not text:
            raise MediaError("Não há foto, áudio ou texto utilizável para extrair.")
        structure = await _run_ai(db, report, photos, text)
        label = await asyncio.to_thread(_persist, db, report_id, structure)
    except ExtractionSuperseded:
        logger.info("Relatório %s mudou durante a extração; resultado descartado.", report_id)
        return "skipped"
    except Exception as exc:
        logger.exception("Falha na extração do relatório %s (tentativa %d)", report_id, attempts + 1)
        message, retryable = public_ai_error(exc)
        final = (not retryable) or attempts + 1 >= MAX_ATTEMPTS
        await asyncio.to_thread(_finish_failure, db, report_id, message, final)
        if final:
            await _notify(db, report_id, failed=True)
        return "failed" if final else "retry"

    await _notify(db, report_id, failed=False, label=label)
    logger.info("Extração concluída para o relatório %s", report_id)
    return "done"


async def process_pending_extractions(limit: int = 20) -> dict:
    """Uma passada do worker: reabre 'processing' travado e processa até
    `limit` relatórios 'pending' (sem atraso mínimo — o backend só marca
    'pending' depois de a mídia estar no Storage)."""
    db = get_admin_client()
    await asyncio.to_thread(_release_stale_processing, db)
    pending = await asyncio.to_thread(_list_pending, db, limit)
    logger.info("Worker: %d relatório(s) pendente(s)", len(pending))

    results = {"processed": 0, "succeeded": 0, "failed": 0, "retry": 0, "skipped": 0}
    for row in pending:
        outcome = await run_auto_extraction(row["id"], row.get("extraction_attempts") or 0)
        results["processed"] += 1
        key = {"done": "succeeded", "failed": "failed", "retry": "retry"}.get(outcome, "skipped")
        results[key] += 1
    return results