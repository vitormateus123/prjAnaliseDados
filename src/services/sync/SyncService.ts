// src/services/sync/SyncService.ts
import NetInfo from '@react-native-community/netinfo';
import { StorageService } from '../../storage/StorageService';
import { apiFetch } from '../api/apiClient';
import { Report } from '../../types/reports';

async function syncOne(report: Report): Promise<boolean> {
  try {
    await apiFetch('/reports/', {
      method: 'POST',
      body: JSON.stringify(report),
    });
    await StorageService.upsertReport({
      ...report,
      status: 'synced',
      synced_at: new Date().toISOString(),
      sync_error: undefined,
    });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Falha ao sincronizar.';
    await StorageService.upsertReport({ ...report, status: 'error', sync_error: message });
    return false;
  }
}

// Sincroniza um único relatório — usado pelo botão "Sincronizar" de cada
// card no Histórico.
export async function syncReport(report: Report): Promise<boolean> {
  const netState = await NetInfo.fetch();
  if (!netState.isConnected) return false;
  return syncOne(report);
}

// Sincroniza todos os relatórios pendentes — usado pelo botão "Sincronizar
// agora" da tela de Ajustes.
export async function syncPendingReports(): Promise<{ success: number; failed: number }> {
  const netState = await NetInfo.fetch();
  if (!netState.isConnected) {
    return { success: 0, failed: 0 }; // offline — tentar depois
  }

  const pending = await StorageService.getPendingReports();
  let success = 0;
  let failed = 0;

  for (const report of pending) {
    const ok = await syncOne(report);
    if (ok) success++;
    else failed++;
  }

  return { success, failed };
}
