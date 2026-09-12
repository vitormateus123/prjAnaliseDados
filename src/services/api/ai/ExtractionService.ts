// src/services/ai/ExtractionService.ts
// Interface genérica — o app nunca depende de Gemini diretamente

import { FormField } from '../../../types/forms';
import { ExtractionResult } from '../../../types/reports';
import { apiUpload } from '../../api/apiClient';

interface BackendExtractResponse {
  success: boolean;
  fields: Array<{ key: string; value: string; confidence: number }>;
  provider: string;
  model: string;
  error?: string;
}

export async function extractFields(
  mediaUri: string,
  mediaType: 'voice' | 'photo',
  fields: FormField[],
  mimeType: string,
): Promise<ExtractionResult> {
  // Monta os hints para o backend
  const fieldHints = fields.map((f) => ({
    key: f.key,
    label: f.label,
    type: f.type,
    extraction_hint: f.extraction_hint ?? null,
  }));
  
  const formData = new FormData();
  formData.append('fields_json', JSON.stringify(fieldHints));
  formData.append('media_type', mediaType);
  formData.append('file', {
    uri: mediaUri,
    type: mimeType,
    name: mediaType === 'voice' ? 'audio.m4a' : 'photo.jpg',
  } as any);
  
  try {
    const result = await apiUpload<BackendExtractResponse>('/extract/', formData);
    return {
      success: result.success,
      fields: result.fields,
      error: result.error,
      provider: result.provider,
      model: result.model,
    };
  } catch (error) {
    return {
      success: false,
      fields: [],
      error: error instanceof Error ? error.message : 'Erro desconhecido',
    };
  }
}