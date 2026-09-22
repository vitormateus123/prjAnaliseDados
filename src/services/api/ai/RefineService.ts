// src/services/api/ai/RefineService.ts
// Serviço de refinamento de campos: pede à IA para (re-)extrair um subconjunto
// de campos a partir das capturas originais de um Report já criado.
//
// Casos de uso:
//  - Campo individual errado ou vazio → usuário toca 🔄 → regera só aquele
//  - Campo adicionado manualmente → usuário pede "IA preencher" → extrai para ele
//  - "Regenerar tudo" → envia todos os campos (exceto os que o chamador quiser manter)
//
// Suporta capturas locais (base64 via expo-file-system) e capturas já
// sincronizadas (file_url remota assinada) — o endpoint /extract/refine aceita
// os dois formatos.

import * as FileSystem from 'expo-file-system/legacy';
import { Capture, ReportField } from '../../../types/reports';
import { apiFetch, EXTRACTION_TIMEOUT_MS } from '../apiClient';
import { FieldType } from '../../../types/forms';

// ─── tipos locais ────────────────────────────────────────────────────────────

export interface RefineTargetField {
  key: string;
  label: string;
  type: FieldType | string;
  extraction_hint?: string;
}

export interface RefinedField {
  key: string;
  value: string;
  confidence: number;
}

export interface RefineResult {
  success: boolean;
  fields: RefinedField[];
  error?: string;
  retryable?: boolean;
}

interface RefineMediaPayload {
  mime_type: string;
  data?: string;       // base64 (arquivo local)
  file_url?: string;   // URL assinada (captura já sincronizada)
}

interface RefinePayload {
  photos: RefineMediaPayload[];
  audio: RefineMediaPayload | null;
  text: string | null;
  target_fields: RefineTargetField[];
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Resolve uma Capture para o formato aceito pelo endpoint /extract/refine.
 * Prefere o arquivo local (base64) quando disponível; cai no file_url quando
 * o arquivo local não existe mais (captura já sincronizada).
 * Retorna null se não houver nenhuma forma de obter a mídia.
 */
async function resolveCapture(
  capture: Capture,
): Promise<RefineMediaPayload | null> {
  const mime = capture.mime_type ?? 'application/octet-stream';

  // Tenta arquivo local primeiro
  if (capture.local_path) {
    try {
      const info = await FileSystem.getInfoAsync(capture.local_path);
      if (info.exists) {
        const data = await FileSystem.readAsStringAsync(capture.local_path, {
          encoding: FileSystem.EncodingType.Base64,
        });
        return { mime_type: mime, data };
      }
    } catch {
      // arquivo local inacessível — cai no file_url abaixo
    }
  }

  // Captura já sincronizada: usa URL remota assinada
  if (capture.file_url) {
    return { mime_type: mime, file_url: capture.file_url };
  }

  return null; // sem mídia disponível
}

// ─── função principal ─────────────────────────────────────────────────────────

/**
 * Pede à IA para (re-)extrair os campos `targetFields` a partir das capturas
 * originais do report. Monta o payload e chama POST /extract/refine.
 *
 * @param captures  As capturas do Report (report.captures)
 * @param targetFields  Campos que a IA deve (re)extrair
 */
export async function refineFields(
  captures: Capture[],
  targetFields: RefineTargetField[],
): Promise<RefineResult> {
  if (targetFields.length === 0) {
    return { success: false, fields: [], error: 'Nenhum campo alvo informado.', retryable: false };
  }

  try {
    const photos: RefineMediaPayload[] = [];
    let audio: RefineMediaPayload | null = null;
    let text: string | null = null;

    for (const capture of captures) {
      if (capture.type === 'text') {
        // Captura de texto digitado — inclui como contexto textual
        const content = capture.text_content?.trim() ?? '';
        if (content) {
          text = text ? `${text}\n\n${content}` : content;
        }
        continue;
      }

      const resolved = await resolveCapture(capture);
      if (!resolved) continue;

      if (capture.type === 'photo') {
        photos.push(resolved);
      } else if (capture.type === 'voice') {
        // Mantém apenas um áudio (o último) — igual ao fluxo original
        audio = resolved;
      }
    }

    // Se não há mídia nem texto, não há como refinar
    if (photos.length === 0 && !audio && !text) {
      return {
        success: false,
        fields: [],
        error: 'Nenhuma mídia original disponível para refinamento.',
        retryable: false,
      };
    }

    const payload: RefinePayload = {
      photos,
      audio,
      text,
      target_fields: targetFields,
    };

    const result = await apiFetch<RefineResult>(
      '/extract/refine',
      { method: 'POST', body: JSON.stringify(payload) },
      EXTRACTION_TIMEOUT_MS,
    );

    return result;
  } catch (error) {
    return {
      success: false,
      fields: [],
      error: error instanceof Error ? error.message : 'Erro desconhecido',
      retryable: true,
    };
  }
}

/**
 * Converte campos de um Report para o formato RefineTargetField.
 * Usa o label como extraction_hint para campos sem hint próprio.
 */
export function toRefineTargetFields(fields: ReportField[]): RefineTargetField[] {
  return fields.map((f) => ({
    key: f.key,
    label: f.label,
    type: f.dynamic_type ?? f.field_value.type,
    extraction_hint: f.label,
  }));
}