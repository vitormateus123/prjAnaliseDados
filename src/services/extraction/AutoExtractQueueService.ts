// src/services/extraction/AutoExtractQueueService.ts
// Fila local de extração assíncrona — espelha o SyncService.
// Processa relatórios com extraction_status === 'pending' quando há conexão.

import { AppState, AppStateStatus } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import * as FileSystem from 'expo-file-system/legacy';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { StorageService } from '../../storage/StorageService';
import { apiFetch, NetworkError, EXTRACTION_TIMEOUT_MS } from '../api/apiClient';
import { autoExtractCombined, StagedPhoto } from '../api/ai/AutoExtractionService';
import { extractFields } from '../api/ai/ExtractionService';
import { Capture, Report, ExtractionStatus } from '../../types/reports';
import { FormField } from '../../types/forms';
import { fetchFormTemplateById } from '../api/forms/TemplatesService';
import { buildReportFields, buildReportItems, buildDynamicReportFields, buildDynamicReportItems } from '../../utils/reportBuilder';
import { summarizeReport } from '../api/ai/SummaryService';

// Configuração do canal de notificação
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const UPLOADABLE_TYPES = new Set<Capture['type']>(['photo', 'voice']);

async function attachCaptureData(captures: Capture[]): Promise<Capture[]> {
  return Promise.all(
    captures.map(async (c) => {
      if (c.file_url || !UPLOADABLE_TYPES.has(c.type) || !c.local_path) return c;
      try {
        const data = await FileSystem.readAsStringAsync(c.local_path, { encoding: 'base64' });
        return { ...c, data };
      } catch (err) {
        if (__DEV__) console.warn('[AutoExtractQueue] não foi possível ler capture local', c.id, err);
        return c;
      }
    }),
  );
}

// Converte Capture[] para StagedPhoto[] (apenas fotos)
function capturesToStagedPhotos(captures: Capture[]): StagedPhoto[] {
  return captures
    .filter((c) => c.type === 'photo' && c.local_path)
    .map((c) => ({
      id: c.id,
      uri: c.local_path!,
      mimeType: c.mime_type ?? 'image/jpeg',
    }));
}

// Encontra o primeiro áudio na captura
function findAudioCapture(captures: Capture[]): Capture | null {
  return captures.find((c) => c.type === 'voice') ?? null;
}

// Encontra o primeiro texto na captura
function findTextCapture(captures: Capture[]): string | null {
  const textCapture = captures.find((c) => c.type === 'text');
  return textCapture?.text_content ?? null;
}

// Envia notificação local de extração concluída
async function sendExtractionCompleteNotification(reportId: string, label: string): Promise<void> {
  try {
    // Pede permissão se ainda não tiver
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') return;

    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Extração concluída',
        body: `${label} está pronto para revisão.`,
        data: { reportId, type: 'extraction_complete' },
      },
      trigger: null, // Imediato
    });
  } catch (err) {
    if (__DEV__) console.warn('[AutoExtractQueue] falha ao enviar notificação', err);
  }
}

async function processPendingReport(report: Report): Promise<{ success: boolean; error?: string }> {
  try {
    // Marca como processing
    await StorageService.upsertReport({
      ...report,
      extraction_status: 'processing',
      updated_at: new Date().toISOString(),
    });

    const capturesWithData = await attachCaptureData(report.captures);
    const photos = capturesToStagedPhotos(capturesWithData);
    const audioCapture = findAudioCapture(capturesWithData);
    const textContent = findTextCapture(capturesWithData);

    let autoResult: Awaited<ReturnType<typeof autoExtractCombined>> | null = null;
    let extractedFields: Awaited<ReturnType<typeof extractFields>> | null = null;

    if (report.form_template_id) {
      // Modo guiado: template já conhecido — usa /extract/ clássico
      const template = await fetchFormTemplateById(report.form_template_id);
      if (!template) {
        throw new Error('Template não encontrado');
      }

      const flatTemplateFields = template.fields.filter((f) => !f.is_item_field);
      const itemTemplateFields = template.fields.filter((f) => f.is_item_field);

      // Para template conhecido, tenta extrair do primeiro áudio/foto disponível
      // Se houver texto digitado, usa ele
      if (audioCapture) {
        extractedFields = await extractFields(
          audioCapture.local_path!,
          'voice',
          flatTemplateFields,
          audioCapture.mime_type ?? 'audio/m4a',
        );
      } else if (photos.length > 0) {
        extractedFields = await extractFields(
          photos[0].uri,
          'photo',
          flatTemplateFields,
          photos[0].mimeType,
        );
      } else if (textContent) {
        // Texto puro — usa autoExtractCombined que suporta texto
        autoResult = await autoExtractCombined({
          photos: [],
          audioUri: null,
          audioMimeType: null,
          text: textContent,
          purpose: report.extraction_purpose ?? null,
          customInstruction: report.extraction_custom_instruction ?? null,
        });
        if (!autoResult.success) {
          throw new Error(autoResult.error ?? 'Falha na extração de texto');
        }
      }
    } else {
      // Modo automático: usa /extract/auto
      autoResult = await autoExtractCombined({
        photos,
        audioUri: audioCapture?.local_path ?? null,
        audioMimeType: audioCapture?.mime_type ?? null,
        text: textContent,
        purpose: report.extraction_purpose ?? null,
        customInstruction: report.extraction_custom_instruction ?? null,
      });

      if (!autoResult.success) {
        throw new Error(autoResult.error ?? 'Falha na extração automática');
      }
    }

    // Constrói os campos/itens do relatório
    let flatFields: Report['fields'] = [];
    let items: Report['items'] = [];

    if (report.form_template_id && extractedFields) {
      // Modo guiado com template
      const template = await fetchFormTemplateById(report.form_template_id!);
      if (template) {
        const flatTemplateFields = template.fields.filter((f) => !f.is_item_field);
        const itemTemplateFields = template.fields.filter((f) => f.is_item_field);

        flatFields = buildReportFields(
          flatTemplateFields,
          extractedFields.success ? extractedFields.fields : null,
        );

        items = template.has_items
          ? buildReportItems(itemTemplateFields, extractedFields.success ? [ { fields: extractedFields.fields } ] : [])
          : [];
      }
    } else if (autoResult && autoResult.success) {
      // Modo automático
      if (autoResult.structure_mode === 'dynamic') {
        flatFields = buildDynamicReportFields(autoResult.dynamic_fields ?? []);
        items = buildDynamicReportItems(autoResult.dynamic_items ?? []);
      } else if (autoResult.template_id) {
        const template = await fetchFormTemplateById(autoResult.template_id);
        if (template) {
          const flatTemplateFields = template.fields.filter((f) => !f.is_item_field);
          const itemTemplateFields = template.fields.filter((f) => f.is_item_field);

          flatFields = buildReportFields(flatTemplateFields, autoResult.fields ?? []);
          items = autoResult.has_items
            ? buildReportItems(itemTemplateFields, autoResult.items ?? [])
            : [];
        }
      }
    }

    // Gera resumo
    const tempReport = { ...report, fields: flatFields, items } as Report;
    const ai_summary = await summarizeReport(tempReport);

    // Atualiza com sucesso
    await StorageService.upsertReport({
      ...report,
      fields: flatFields,
      items,
      extraction_status: 'done',
      extraction_attempts: (report.extraction_attempts ?? 0) + 1,
      extraction_last_error: null,
      ai_summary,
      updated_at: new Date().toISOString(),
    });

    // Notificação local
    const label = report.context_label ?? report.form_template_name ?? 'Relatório';
    await sendExtractionCompleteNotification(report.id, label);

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido na extração';
    if (__DEV__) console.error('[AutoExtractQueue] falha ao processar', report.id, error);

    await StorageService.upsertReport({
      ...report,
      extraction_status: 'pending', // Mantém pending para retry
      extraction_attempts: (report.extraction_attempts ?? 0) + 1,
      extraction_last_error: message,
      updated_at: new Date().toISOString(),
    });

    return { success: false, error: message };
  }
}

async function processPendingExtractions(): Promise<{ processed: number; succeeded: number; failed: number }> {
  const allReports = await StorageService.getAllReports();
  const pending = allReports.filter(
    (r) => r.extraction_status === 'pending' || r.extraction_status === 'processing',
  );

  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  for (const report of pending) {
    const result = await processPendingReport(report);
    processed++;
    if (result.success) succeeded++;
    else failed++;
  }

  return { processed, succeeded, failed };
}

// ─── sincronização automática em segundo plano ──────────────────────────
const AUTO_EXTRACT_INTERVAL_MS = 2 * 60 * 1000; // 2 min
const DEBOUNCE_MS = 1500;

let isExtracting = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

async function attemptAutoExtract(): Promise<void> {
  if (isExtracting) return;
  isExtracting = true;
  try {
    await processPendingExtractions();
  } catch (err) {
    if (__DEV__) console.error('[AutoExtractQueue] auto-extract falhou', err);
  } finally {
    isExtracting = false;
  }
}

function scheduleAutoExtract(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(attemptAutoExtract, DEBOUNCE_MS);
}

/**
 * Liga a extração automática em segundo plano — sem botão, sem
 * depender do usuário lembrar. Chamar UMA VEZ na raiz do app (App.tsx).
 *
 * Gatilhos que disparam uma tentativa:
 * - qualquer evento do NetInfo (troca de wifi, sinal voltou, etc.)
 * - o app voltar pro primeiro plano (o dispositivo pode ter saído da área
 *   sem sinal e voltado enquanto estava em segundo plano)
 * - um intervalo de segurança, caso os dois gatilhos acima não disparem
 *   por algum motivo
 *
 * Retorna uma função de cleanup (útil sobretudo em testes; no app real o
 * componente raiz normalmente não desmonta).
 */
export function startAutoExtractQueue(): () => void {
  const netUnsubscribe = NetInfo.addEventListener(() => {
    scheduleAutoExtract();
  });

  const appStateSubscription = AppState.addEventListener('change', (state: AppStateStatus) => {
    if (state === 'active') scheduleAutoExtract();
  });

  const interval = setInterval(attemptAutoExtract, AUTO_EXTRACT_INTERVAL_MS);

  // Tenta uma vez já na inicialização — cobre o caso de relatórios
  // pendentes de uma sessão anterior que ficaram sem extração.
  scheduleAutoExtract();

  return () => {
    netUnsubscribe();
    appStateSubscription.remove();
    clearInterval(interval);
    if (debounceTimer) clearTimeout(debounceTimer);
  };
}

// Exporta para uso manual (botão "Tentar agora" em Ajustes)
export async function processAllPendingExtractions(): Promise<{ processed: number; succeeded: number; failed: number }> {
  return processPendingExtractions();
}