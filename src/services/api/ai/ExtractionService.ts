// src/services/ai/ExtractionService.ts
// Interface genérica — o app nunca depende de Gemini diretamente
//
// NOTA: não usamos fetch()+FormData aqui de propósito. A partir de certas
// versões do Expo SDK, o FormData global embutido no runtime deixou de ser
// compatível com o padrão clássico do React Native de anexar arquivo por URI
// ({ uri, type, name }), e passou a lançar "Unsupported FormDataPart
// implementation". FileSystem.uploadAsync faz upload multipart nativamente
// e não depende do FormData do JS, então evita o problema por completo.

import * as FileSystem from 'expo-file-system/legacy';
import { FormField } from '../../../types/forms';
import { ExtractionResult } from '../../../types/reports';
import { BASE_URL } from '../../api/apiClient';

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

  try {
    const uploadResult = await FileSystem.uploadAsync(`${BASE_URL}/extract/`, mediaUri, {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: 'file',
      mimeType,
      parameters: {
        fields_json: JSON.stringify(fieldHints),
        media_type: mediaType,
      },
    });

    if (uploadResult.status < 200 || uploadResult.status >= 300) {
      throw new Error(`Upload error ${uploadResult.status}: ${uploadResult.body}`);
    }

    const result: BackendExtractResponse = JSON.parse(uploadResult.body);
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