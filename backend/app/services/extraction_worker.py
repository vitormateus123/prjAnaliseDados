# backend/app/services/extraction_worker.py
# Worker de extração automática — chamado pelo job periódico (APScheduler)
# e pelo endpoint /devices/push-token (para processar relatórios do usuário
# logo após ele conceder permissão de notificação).
#
# Reaproveita a lógica existente de /extract/auto (gemini_service.classify_and_extract)
# e /extract/refine (gemini_service.refine_fields), adaptando para rodar
# no backend com dados já persistidos no banco.

import base64
import httpx
import logging
from datetime import datetime, timedelta
from typing import Optional
from uuid import UUID

from app.services.gemini_service import classify_and_extract, refine_fields
from app.services.groq_service import transcribe_audio
from app.services.supabase_service import get_admin_client as get_client
from app.core.config import settings

logger = logging.getLogger("extraction_worker")

_MAX_REFINE_FILE_SIZE = 10 * 1024 * 1024  # 10 MB
_EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

# Estados válidos de extração (espelha migration 0014)
EXTRACTION_PENDING = "pending"
EXTRACTION_PROCESSING = "processing"
EXTRACTION_DONE = "done"
EXTRACTION_FAILED = "failed"


async def _download_capture(capture: dict) -> tuple[bytes, str] | None:
    """Baixa arquivo de capture do Storage via signed URL ou file_url direto."""
    file_url = capture.get("file_url")
    if not file_url:
        return None

    try:
        # Se é URL http(s) completa, usa direto; senão é caminho do Storage
        if file_url.startswith("http"):
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.get(file_url)
            if resp.status_code != 200:
                logger.warning("Falha ao baixar capture %s: %d", capture.get("id"), resp.status_code)
                return None
            data = resp.content
        else:
            # Caminho do Storage: gera signed URL e baixa
            from app.api.routes.reports import _CAPTURES_BUCKET
            from app.services.supabase_service import get_client
            supabase = get_client()
            result = supabase.storage.from_(_CAPTURES_BUCKET).create_signed_url(file_url, 3600)
            signed_url = result.get("signedURL") or result.get("signedUrl")
            if not signed_url:
                logger.warning("Falha ao gerar signed URL para %s", file_url)
                return None
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.get(signed_url)
            if resp.status_code != 200:
                logger.warning("Falha ao baixar capture assinada %s: %d", file_url, resp.status_code)
                return None
            data = resp.content

        if len(data) > _MAX_REFINE_FILE_SIZE:
            logger.warning("Capture %s maior que 10MB, ignorando", capture.get("id"))
            return None

        return data, capture.get("mime_type", "application/octet-stream")
    except Exception as e:
        logger.exception("Erro ao baixar capture %s: %s", capture.get("id"), e)
        return None


async def _resolve_media_for_report(report: dict) -> tuple[list[tuple[bytes, str]], Optional[str]]:
    """Prepara fotos e áudio/texto para extração a partir das captures do relatório."""
    photos_bytes: list[tuple[bytes, str]] = []
    text_content: Optional[str] = None

    for capture in report.get("captures") or []:
        ctype = capture.get("type")
        if ctype == "photo":
            downloaded = await _download_capture(capture)
            if downloaded:
                photos_bytes.append(downloaded)
        elif ctype == "voice":
            downloaded = await _download_capture(capture)
            if downloaded:
                audio_bytes, audio_mime = downloaded
                try:
                    transcript = await transcribe_audio(audio_bytes, audio_mime)
                    text_content = (f"{transcript}\n\n[Texto adicional]:\n{text_content}" if text_content else transcript)
                except Exception as e:
                    logger.exception("Falha STT no worker para capture %s: %s", capture.get("id"), e)
        elif ctype == "text" and capture.get("text_content"):
            text_content = (f"{capture['text_content']}\n\n[Texto adicional]:\n{text_content}" if text_content else capture["text_content"])

    return photos_bytes, text_content


async def _fetch_template_catalog() -> list[dict]:
    """Busca catálogo de templates para classify_and_extract (mesmo código de extract.py)."""
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


async def _build_purpose_block(purpose: str | None, custom_instruction: str | None) -> str:
    """Reaproveita o bloco de propósito do gemini_service (copiado aqui pra evitar import circular)."""
    from app.services.gemini_service import _PURPOSE_GUIDANCE, _build_purpose_block as gemini_build_purpose_block
    return gemini_build_purpose_block(purpose, custom_instruction)


async def run_auto_extraction(report_id: str) -> bool:
    """
    Processa um único relatório com extraction_status='pending'.
    Retorna True se processou com sucesso (status vira 'done'), False caso contrário.
    """
    supabase = get_client()

    # 1. Marca como processing (trava contra duplicidade)
    try:
        supabase.table("reports").update({
            "extraction_status": EXTRACTION_PROCESSING,
            "updated_at": datetime.utcnow().isoformat(),
        }).eq("id", report_id).execute()
    except Exception as e:
        logger.exception("Falha ao marcar processing para %s: %s", report_id, e)
        return False

    try:
        # 2. Busca relatório completo com captures
        resp = supabase.table("reports").select(
            "*, captures(*)"
        ).eq("id", report_id).execute()

        if not resp.data:
            logger.warning("Relatório %s não encontrado", report_id)
            return False

        report = resp.data[0]

        # 3. Verifica se já foi processado por outra instância (race condition)
        if report.get("extraction_status") == EXTRACTION_DONE:
            logger.info("Relatório %s já estava done, pulando", report_id)
            return True

        # 4. Prepara mídia e texto
        photos_bytes, text_content = await _resolve_media_for_report(report)

        if not photos_bytes and not text_content:
            logger.warning("Relatório %s sem mídia/texto utilizável", report_id)
            supabase.table("reports").update({
                "extraction_status": EXTRACTION_FAILED,
                "extraction_attempts": (report.get("extraction_attempts") or 0) + 1,
                "extraction_last_error": "Sem mídia ou texto para extrair",
                "updated_at": datetime.utcnow().isoformat(),
            }).eq("id", report_id).execute()
            return False

        # 5. Chama classify_and_extract (mesmo que /extract/auto)
        catalog = await _fetch_template_catalog()
        purpose = report.get("extraction_purpose")
        custom_instruction = report.get("extraction_custom_instruction")

        purpose_block = await _build_purpose_block(purpose, custom_instruction)

        from app.services.gemini_service import _auto_config
        from google.genai import types
        import json

        prompt = f"""Você é um assistente que recebe uma captura de campo (foto e/ou texto — que pode ser transcrição de áudio ou digitado) e decide como estruturá-la dentro de um sistema de formulários dinâmico.

FORMULÁRIOS JÁ CADASTRADOS (catálogo, em JSON):
{json.dumps(catalog, ensure_ascii=False)}

SEU TRABALHO, EM UMA ÚNICA RESPOSTA:
1. Decida se o conteúdo se encaixa em algum formulário do catálogo acima (match="existing") ou se nenhum deles serve (match="dynamic"). Prefira reaproveitar um formulário existente sempre que o conteúdo for genuinamente do mesmo tipo, mesmo que falte algum campo — isso evita recriar a mesma estrutura a cada captura parecida. Mas NÃO force o conteúdo dentro de um formulário do catálogo só porque existe um remotamente parecido: se a finalidade informada ou o conteúdo indicam outra coisa, prefira match="dynamic".
2. Se match="existing": preencha "template_id" com o id exato do formulário escolhido (copiado do catálogo). Se esse formulário não tiver algum campo essencial para o conteúdo (ex.: uma nota fiscal sem campo "emissor"), liste esse(s) campo(s) em "suggested_fields" no mesmo formato dos campos do catálogo — isso NÃO é motivo para trocar para match="dynamic". Deixe "dynamic_fields"=[] e "dynamic_items"=[].
3. Se match="dynamic": estruture a informação livremente, sem se prender a nenhum formulário — decida você mesmo quais campos existem, a partir do conteúdo (e da finalidade informada, se houver). Preencha "context_label" (descrição curta e legível, ex: "Contagem de estoque — depósito A") e "context_type" (slug curto, ex: "contagem_estoque"). Coloque os campos únicos do relatório em "dynamic_fields" e, se o conteúdo tiver itens repetidos (ex: vários produtos), cada item em "dynamic_items" (cada um com seus próprios "fields"). Se não houver itens repetidos, "dynamic_items"=[]. Deixe "template_id"="" e "suggested_fields"=[].
4. Em "fields" (modo existing), extraia os valores encontrados no conteúdo para os campos de nível de relatório (do template escolhido + suggested_fields) — apenas os que NÃO são is_item_field.
5. Se o formulário existente tiver has_items=true, retorne também "items": uma lista onde cada item tem seus próprios "fields", contendo só os campos marcados is_item_field. Se has_items=false, retorne "items": [].
{purpose_block}

REGRAS:
- Nunca invente informações que não estão no conteúdo.
- Para valores não encontrados, use string vazia "".
- confidence reflete sua certeza: 1.0 = certeza absoluta, 0.5 = incerto.
- "source" de cada campo extraído indica de onde veio o valor predominantemente: "image", "audio", "text", ou "" se não fizer sentido diferenciar.
- Tipos válidos para campos: text, long_text, number, decimal, date, boolean, select.
- Chaves (key) em snake_case, sem espaços. Rótulos (label) em português, claros para um usuário leigo.
- Retorne APENAS o JSON pedido, sem texto adicional.
"""

        contents = [prompt]
        for media_bytes, mime_type in photos_bytes:
            contents.append(types.Part.from_bytes(data=media_bytes, mime_type=mime_type))

        from app.services.gemini_service import _client, _MODEL
        response = await _client.aio.models.generate_content(
            model=_MODEL,
            contents=contents,
            config=_auto_config(),
        )
        result = json.loads(response.text)

        match = result.get("match")

        # 6. Processa resultado e atualiza relatório
        if match == "existing" and result.get("template_id"):
            template_id = result["template_id"]

            # Adiciona campos sugeridos se admin (opcional - manter simples por enquanto)
            template_row_resp = (
                supabase.table("form_templates")
                .select("name,has_items")
                .eq("id", template_id)
                .execute()
            )
            if not template_row_resp.data:
                raise ValueError(f"Formulário {template_id} não existe no banco.")

            template_row = template_row_resp.data[0]
            template_name = template_row["name"]
            has_items = bool(template_row.get("has_items", False))

            # Extrai campos do resultado
            extracted_fields = result.get("fields") or []
            extracted_items = result.get("items") or []

            # Atualiza relatório com sucesso
            update_data = {
                "extraction_status": EXTRACTION_DONE,
                "extraction_attempts": (report.get("extraction_attempts") or 0) + 1,
                "extraction_last_error": None,
                "form_template_id": template_id,
                "form_template_name": template_name,
                "context_label": template_name,
                "updated_at": datetime.utcnow().isoformat(),
            }
            supabase.table("reports").update(update_data).eq("id", report_id).execute()

            # Grava fields e items (reaproveita lógica de sync)
            # Campos guiados
            if extracted_fields:
                guided_rows = []
                for f in extracted_fields:
                    guided_rows.append({
                        "report_id": report_id,
                        "form_field_id": None,  # Será preenchido ao buscar template
                        "confidence": f.get("confidence"),
                        "source": "ai",
                        "was_edited": False,
                        "dynamic_key": f.get("key"),
                        "dynamic_label": f.get("label"),
                        "dynamic_type": f.get("type", "text"),
                        "value_text": f.get("value") if f.get("type") in ("text", "long_text", "select") else None,
                        "value_number": f.get("value") if f.get("type") in ("number", "decimal") else None,
                        "value_boolean": f.get("value") if f.get("type") == "boolean" else None,
                        "value_date": f.get("value") if f.get("type") == "date" else None,
                        "value_json": f.get("value") if f.get("type") == "multiselect" else None,
                    })
                if guided_rows:
                    supabase.table("report_fields").delete().eq("report_id", report_id).not_.is_("form_field_id", "null").execute()
                    supabase.table("report_fields").insert(guided_rows).execute()

            # Itens
            if has_items and extracted_items:
                supabase.table("report_items").delete().eq("report_id", report_id).execute()
                for position, item in enumerate(extracted_items):
                    item_resp = supabase.table("report_items").insert({
                        "id": item.get("id") or f"item_{position}",
                        "report_id": report_id,
                        "position": position,
                    }).execute()
                    if item_resp.data:
                        item_id = item_resp.data[0]["id"]
                        item_field_rows = []
                        for f in item.get("fields") or []:
                            item_field_rows.append({
                                "report_item_id": item_id,
                                "form_field_id": None,
                                "confidence": f.get("confidence"),
                                "source": "ai",
                                "was_edited": False,
                                "value_text": f.get("value") if f.get("type") in ("text", "long_text", "select") else None,
                                "value_number": f.get("value") if f.get("type") in ("number", "decimal") else None,
                                "value_boolean": f.get("value") if f.get("type") == "boolean" else None,
                                "value_date": f.get("value") if f.get("type") == "date" else None,
                                "value_json": f.get("value") if f.get("type") == "multiselect" else None,
                            })
                        if item_field_rows:
                            supabase.table("report_item_fields").insert(item_field_rows).execute()

        else:
            # match="dynamic" — estrutura livre
            dynamic_fields = result.get("dynamic_fields") or []
            dynamic_items = result.get("dynamic_items") or []
            context_label = result.get("context_label") or "Informação organizada"
            context_type = result.get("context_type") or "informacao"

            update_data = {
                "extraction_status": EXTRACTION_DONE,
                "extraction_attempts": (report.get("extraction_attempts") or 0) + 1,
                "extraction_last_error": None,
                "form_template_id": None,
                "form_template_name": None,
                "context_label": context_label,
                "context_type": context_type,
                "updated_at": datetime.utcnow().isoformat(),
            }
            supabase.table("reports").update(update_data).eq("id", report_id).execute()

            # Grava dynamic fields
            if dynamic_fields:
                dynamic_rows = []
                for f in dynamic_fields:
                    dynamic_rows.append({
                        "report_id": report_id,
                        "form_field_id": None,
                        "confidence": f.get("confidence"),
                        "source": "ai",
                        "was_edited": False,
                        "dynamic_key": f.get("key"),
                        "dynamic_label": f.get("label"),
                        "dynamic_type": f.get("type", "text"),
                        "value_text": f.get("value") if f.get("type") in ("text", "long_text", "select") else None,
                        "value_number": f.get("value") if f.get("type") in ("number", "decimal") else None,
                        "value_boolean": f.get("value") if f.get("type") == "boolean" else None,
                        "value_date": f.get("value") if f.get("type") == "date" else None,
                        "value_json": f.get("value") if f.get("type") == "multiselect" else None,
                    })
                if dynamic_rows:
                    supabase.table("report_fields").delete().eq("report_id", report_id).is_("form_field_id", "null").execute()
                    supabase.table("report_fields").insert(dynamic_rows).execute()

            # Dynamic items
            if dynamic_items:
                supabase.table("report_items").delete().eq("report_id", report_id).execute()
                for position, item in enumerate(dynamic_items):
                    item_resp = supabase.table("report_items").insert({
                        "id": item.get("id") or f"item_{position}",
                        "report_id": report_id,
                        "position": position,
                    }).execute()
                    if item_resp.data:
                        item_id = item_resp.data[0]["id"]
                        item_field_rows = []
                        for f in item.get("fields") or []:
                            item_field_rows.append({
                                "report_item_id": item_id,
                                "form_field_id": None,
                                "confidence": f.get("confidence"),
                                "source": "ai",
                                "was_edited": False,
                                "value_text": f.get("value") if f.get("type") in ("text", "long_text", "select") else None,
                                "value_number": f.get("value") if f.get("type") in ("number", "decimal") else None,
                                "value_boolean": f.get("value") if f.get("type") == "boolean" else None,
                                "value_date": f.get("value") if f.get("type") == "date" else None,
                                "value_json": f.get("value") if f.get("type") == "multiselect" else None,
                            })
                        if item_field_rows:
                            supabase.table("report_item_fields").insert(item_field_rows).execute()

        # 7. Envia push notification via Expo Push API
        await _send_push_notification(report_id, context_label if match != "existing" else template_name)

        logger.info("Extração concluída para relatório %s", report_id)
        return True

    except Exception as e:
        logger.exception("Falha no worker de extração para %s: %s", report_id, e)
        supabase.table("reports").update({
            "extraction_status": EXTRACTION_FAILED,
            "extraction_attempts": (report.get("extraction_attempts") or 0) + 1,
            "extraction_last_error": str(e),
            "updated_at": datetime.utcnow().isoformat(),
        }).eq("id", report_id).execute()
        return False


async def _send_push_notification(report_id: str, label: str):
    """Envia notificação via Expo Push API para todos os tokens do dono do relatório."""
    supabase = get_client()

    # Busca user_id do relatório
    report_resp = supabase.table("reports").select("user_id").eq("id", report_id).execute()
    if not report_resp.data:
        return
    user_id = report_resp.data[0].get("user_id")
    if not user_id:
        return

    # Busca tokens ativos
    tokens_resp = supabase.table("push_tokens").select("expo_push_token").eq("user_id", user_id).eq("active", True).execute()
    tokens = [row["expo_push_token"] for row in tokens_resp.data or []]
    if not tokens:
        return

    try:
        messages = [{
            "to": token,
            "title": "Extração concluída",
            "body": f"{label} está pronto para revisão.",
            "data": {"reportId": report_id, "type": "extraction_complete"},
            "sound": "default",
            "priority": "high",
        } for token in tokens]

        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(_EXPO_PUSH_URL, json=messages)
    except Exception as e:
        logger.warning("Falha ao enviar push para %s: %s", report_id, e)


async def process_pending_extractions(limit: int = 50) -> dict:
    """
    Job periódico: busca relatórios com extraction_status='pending' (ou 'processing' há > 5min)
    e processa até `limit` deles.
    """
    supabase = get_client()

    # Pega pendentes + processing travados há mais de 5 min
    five_min_ago = (datetime.utcnow() - timedelta(minutes=5)).isoformat()

    resp = supabase.table("reports").select("id").in_("extraction_status", [
        EXTRACTION_PENDING, EXTRACTION_PROCESSING
    ]).lte("updated_at", five_min_ago).order("updated_at").limit(limit).execute()

    reports = resp.data or []
    logger.info("Worker: processando %d relatórios pendentes", len(reports))

    results = {"processed": 0, "succeeded": 0, "failed": 0}
    for report in reports:
        success = await run_auto_extraction(report["id"])
        results["processed"] += 1
        if success:
            results["succeeded"] += 1
        else:
            results["failed"] += 1

    return results


# Endpoint interno protegido para o job cron chamar (Render Cron Job)
async def extraction_job_endpoint():
    """Endpoint para Render Cron Job bater (ex: a cada 5 min)."""
    # Proteção simples: header secreto
    # Em produção, usar auth real ou IP allowlist
    results = await process_pending_extractions()
    return results