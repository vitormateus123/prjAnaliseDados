// src/services/sync/SyncService.ts
import { AppState, AppStateStatus } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
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

// ─── sincronização automática em segundo plano ──────────────────────────
//
// Igual ao syncOne acima: não usamos NetInfo.isConnected como portão, só
// como GATILHO pra tentar. Quem decide de verdade se deu certo é a
// tentativa real de rede dentro de syncOne/apiFetch. Por isso os disparos
// abaixo são "deixa eu tentar", nunca "confirmei que há internet".
const AUTO_SYNC_INTERVAL_MS = 2 * 60 * 1000; // rede de campo é instável — reforço periódico
const DEBOUNCE_MS = 1500; // várias mudanças de rede seguidas viram uma tentativa só

let isSyncing = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

async function attemptAutoSync(): Promise<void> {
  if (isSyncing) return;
  isSyncing = true;
  try {
    await syncPendingReports();
  } catch (err) {
    // Nunca deixa um erro de sync automático quebrar o app — o usuário só
    // vê o resultado no card do relatório (status/sync_error), sem alertas.
    if (__DEV__) console.error('[SyncService] auto-sync falhou', err);
  } finally {
    isSyncing = false;
  }
}

function scheduleAutoSync(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(attemptAutoSync, DEBOUNCE_MS);
}

/**
 * Liga a sincronização automática em segundo plano — sem botão, sem
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
export function startAutoSync(): () => void {
  const netUnsubscribe = NetInfo.addEventListener(() => {
    scheduleAutoSync();
  });

  const appStateSubscription = AppState.addEventListener('change', (state: AppStateStatus) => {
    if (state === 'active') scheduleAutoSync();
  });

  const interval = setInterval(attemptAutoSync, AUTO_SYNC_INTERVAL_MS);

  // Tenta uma vez já na inicialização — cobre o caso de relatórios
  // pendentes de uma sessão anterior que ficaram sem sincronizar.
  scheduleAutoSync();

  return () => {
    netUnsubscribe();
    appStateSubscription.remove();
    clearInterval(interval);
    if (debounceTimer) clearTimeout(debounceTimer);
  };
}