// src/services/sync/SyncService.ts
import NetInfo from '@react-native-community/netinfo';
import { StorageService } from '../../storage/StorageService';
import { apiFetch } from '../api/apiClient';

export async function syncPendingReports(): Promise<{ success: number; failed: number }> {
  const netState = await NetInfo.fetch();
  if (!netState.isConnected) {
    return { success: 0, failed: 0 }; // offline — tentar depois
  }
  
  const pending = await StorageService.getPendingReports();
  let success = 0;
  let failed = 0;
  
  for (const report of pending) {
    try {
      await apiFetch('/reports/', {
        method: 'POST',
        body: JSON.stringify(report),
      });
      await StorageService.upsertReport({
        ...report,
        status: 'synced',
        synced_at: new Date().toISOString(),
      });
      success++;
    } catch {
      await StorageService.upsertReport({ ...report, status: 'error' });
      failed++;
    }
  }
  
  return { success, failed };
}