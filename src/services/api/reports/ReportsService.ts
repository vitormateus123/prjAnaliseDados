// src/services/api/reports/ReportsService.ts
// Busca os relatórios que já existem no Supabase (via backend). Diferente
// de StorageService (que só lê o AsyncStorage local), isso é o que mostra
// "o que está no banco de verdade" — usado pelo Histórico para mesclar
// com os rascunhos locais que ainda não foram sincronizados.

import { apiFetch } from '../apiClient';
import { Report } from '../../../types/reports';

export async function fetchRemoteReports(): Promise<Report[]> {
  return apiFetch<Report[]>('/reports/');
}