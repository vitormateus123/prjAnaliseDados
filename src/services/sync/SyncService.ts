// src/services/sync/SyncService.ts
import { StorageService } from '../../storage/StorageService';
import { apiFetch, NetworkError } from '../api/apiClient';
import { Report } from '../../types/reports';

/**
 * IMPORTANTE: não usamos mais NetInfo.isConnected() como portão antes de
 * tentar sincronizar. Em várias redes Wi-Fi (comum em rede de escola) esse
 * valor vem `false` mesmo com internet funcionando, e o código anterior
 * simplesmente desistia sem tentar e sem marcar erro — o relatório ficava
 * "Pendente" para sempre sem nenhuma pista do motivo.
 *
 * Agora sempre tentamos de verdade. Se realmente não houver rede, o
 * apiFetch da apiClient.ts estoura um NetworkError e isso vira um
 * sync_error visível no card, em vez de um silêncio.
 */
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
    if (__DEV__) console.error('[SyncService] falha ao sincronizar', report.id, err);
    const message =
      err instanceof NetworkError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'Falha ao sincronizar.';
    await StorageService.upsertReport({ ...report, status: 'error', sync_error: message });
    return false;
  }
}

// Sincroniza um único relatório — usado pelo botão "Sincronizar" de cada
// card no Histórico. Sempre marca status/erro no relatório, então o
// resultado booleano é só para feedback imediato (ex: desabilitar spinner).
export async function syncReport(report: Report): Promise<boolean> {
  return syncOne(report);
}

// Sincroniza todos os relatórios pendentes — usado pelo botão "Sincronizar
// agora" da tela de Ajustes.
export async function syncPendingReports(): Promise<{ success: number; failed: number }> {
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