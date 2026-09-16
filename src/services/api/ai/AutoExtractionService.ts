// src/services/api/ai/AutoExtractionService.ts
// Fluxo automático: o app manda a captura inteira — uma ou mais fotos,
// e/ou um áudio, e/ou um texto digitado, podendo combinar tudo — sem
// escolher formulário antes. O backend classifica entre os templates
// existentes ou propõe um novo, e já devolve os campos (ou itens) extraídos.
// Ver POST /extract/auto.
//
// Vai como JSON com os arquivos em base64, e não como multipart com vários
// arquivos binários: expo-file-system's uploadAsync só sobe UM arquivo por
// chamada, e o FormData nativo do RN quebra com múltiplos file parts nesta
// versão do Expo ("Unsupported FormDataPart implementation" — mesmo motivo
// documentado em ExtractionService.ts). Base64 dentro de JSON funciona bem
// para o tamanho de arquivo esperado aqui (fotos/áudios de poucos MB, com
// limite de 10MB por arquivo já validado no backend).

import * as FileSystem from 'expo-file-system/legacy';
import { AutoExtractionResult } from '../../../types/reports';
import { apiFetch } from '../apiClient';

interface MediaItemPayload {
  data: string; // base64
  mime_type: string;
}

export interface StagedPhoto {
  id: string;
  uri: string;
  mimeType: string;
}

export interface AutoExtractInput {
  photos?: StagedPhoto[];
  audioUri?: string | null;
  audioMimeType?: string | null;
  text?: string | null;
}

const EMPTY_RESULT_BASE: Omit<AutoExtractionResult, 'error' | 'retryable'> = {
  success: false,
  template_id: '',
  template_name: '',
  template_is_new: false,
  has_items: false,
  fields: [],
  items: [],
};

async function toMediaItem(uri: string, mimeType: string): Promise<MediaItemPayload> {
  const data = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
  return { data, mime_type: mimeType };
}

// Recebe uma combinação de fotos/áudio/texto anexados numa mesma captura e
// manda tudo junto pro backend decidir o formulário e extrair os campos.
export async function autoExtractCombined(input: AutoExtractInput): Promise<AutoExtractionResult> {
  const photos = input.photos ?? [];
  const hasAudio = !!input.audioUri;
  const hasText = !!input.text && input.text.trim().length > 0;

  if (photos.length === 0 && !hasAudio && !hasText) {
    return {
      ...EMPTY_RESULT_BASE,
      error: 'Nenhuma informação anexada para enviar.',
      retryable: false,
    };
  }

  try {
    const [photoItems, audioItem] = await Promise.all([
      Promise.all(photos.map((p) => toMediaItem(p.uri, p.mimeType))),
      hasAudio
        ? toMediaItem(input.audioUri as string, input.audioMimeType || 'audio/m4a')
        : Promise.resolve(null),
    ]);

    const body = {
      photos: photoItems,
      audio: audioItem,
      text: hasText ? (input.text as string).trim() : null,
    };

    return await apiFetch<AutoExtractionResult>('/extract/auto', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  } catch (error) {
    return {
      ...EMPTY_RESULT_BASE,
      error: error instanceof Error ? error.message : 'Erro desconhecido',
      retryable: true,
    };
  }
}