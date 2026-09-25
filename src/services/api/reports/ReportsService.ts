// src/services/api/reports/ReportsService.ts
// Busca os relatórios que já existem no Supabase (via backend). Diferente
// de StorageService (que só lê o AsyncStorage local), isso é o que mostra
// "o que está no banco de verdade" — usado pelo Histórico para mesclar
// com os rascunhos locais que ainda não foram sincronizados.

import { apiFetch, UPLOAD_TIMEOUT_MS } from '../apiClient';
import { Report } from '../../../types/reports';

export async function fetchRemoteReports(): Promise<Report[]> {
  // Timeout maior que o padrão: além do cold start do Render, esta rota
  // agora gera uma signed URL por capture com arquivo salvo (uma chamada
  // extra ao Storage por captura) pra permitir exibir a fonte de origem.
  return apiFetch<Report[]>('/reports/', undefined, UPLOAD_TIMEOUT_MS);
}

/** Apaga o relatório no servidor (Supabase, via backend). Necessário além
 * de StorageService.deleteReport: um relatório já sincronizado que só é
 * apagado localmente volta sozinho no próximo refresh, porque o Histórico
 * remescla com o que ainda existe no servidor. */
export async function deleteRemoteReport(reportId: string): Promise<void> {
  await apiFetch<{ deleted: boolean }>(`/reports/${reportId}`, { method: 'DELETE' });
}