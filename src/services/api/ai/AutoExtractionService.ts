// src/services/api/ai/AutoExtractionService.ts
// Fluxo novo (Fase 3): o app manda só a mídia, sem escolher formulário
// antes — o backend classifica entre os templates existentes ou propõe um
// novo, e já devolve os campos (ou itens) extraídos. Ver /extract/auto.
//
// Mesma técnica de upload de ExtractionService.ts (FileSystem.uploadAsync
// em vez de fetch+FormData) — ver comentário lá pra detalhes do porquê.

import * as FileSystem from 'expo-file-system/legacy';
import { AutoExtractionResult } from '../../../types/reports';
import { BASE_URL, apiUpload } from '../apiClient';

export async function autoExtractFields(
  mediaUri: string,
  mediaType: 'voice' | 'photo',
  mimeType: string,
): Promise<AutoExtractionResult> {
  try {
    const uploadResult = await FileSystem.uploadAsync(`${BASE_URL}/extract/auto`, mediaUri, {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: 'file',
      mimeType,
      parameters: {
        media_type: mediaType,
      },
    });

    if (uploadResult.status < 200 || uploadResult.status >= 300) {
      throw new Error(`Upload error ${uploadResult.status}: ${uploadResult.body}`);
    }

    return JSON.parse(uploadResult.body) as AutoExtractionResult;
  } catch (error) {
    return {
      success: false,
      template_id: '',
      template_name: '',
      template_is_new: false,
      has_items: false,
      fields: [],
      items: [],
      error: error instanceof Error ? error.message : 'Erro desconhecido',
      retryable: true,
    };
  }
}

// Texto digitado não tem arquivo pra subir — vai como campo de formulário
// mesmo, via apiUpload (multipart simples, sem FileSystem.uploadAsync).
export async function autoExtractFromText(text: string): Promise<AutoExtractionResult> {
  try {
    const formData = new FormData();
    formData.append('media_type', 'text');
    formData.append('text', text);
    return await apiUpload<AutoExtractionResult>('/extract/auto', formData);
  } catch (error) {
    return {
      success: false,
      template_id: '',
      template_name: '',
      template_is_new: false,
      has_items: false,
      fields: [],
      items: [],
      error: error instanceof Error ? error.message : 'Erro desconhecido',
      retryable: true,
    };
  }
}