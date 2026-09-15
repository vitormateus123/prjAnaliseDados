// src/services/storage/StorageService.ts
// Abstração que pode ser substituída por SQLite sem alterar o resto do app

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Report } from './../types/reports';

const REPORTS_KEY = 'campo_reports_v2';

export const StorageService = {
  async getAllReports(): Promise<Report[]> {
    const raw = await AsyncStorage.getItem(REPORTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Report[];
    // Relatórios salvos antes da Fase 1 (itens) não têm `items` no JSON —
    // normaliza pra [] pra não quebrar quem faz report.items.map/length.
    return parsed.map((r) => ({ ...r, items: r.items ?? [] }));
  },

  async upsertReport(report: Report): Promise<void> {
    const all = await this.getAllReports();
    const idx = all.findIndex((r) => r.id === report.id);
    if (idx >= 0) {
      all[idx] = { ...report, updated_at: new Date().toISOString() };
    } else {
      all.unshift(report);
    }
    await AsyncStorage.setItem(REPORTS_KEY, JSON.stringify(all));
  },

  async getReportById(id: string): Promise<Report | null> {
    const all = await this.getAllReports();
    return all.find((r) => r.id === id) ?? null;
  },

  async deleteReport(id: string): Promise<void> {
    const all = await this.getAllReports();
    await AsyncStorage.setItem(REPORTS_KEY, JSON.stringify(all.filter((r) => r.id !== id)));
  },

  async getPendingReports(): Promise<Report[]> {
    const all = await this.getAllReports();
    return all.filter((r) => r.status === 'pending_sync');
  },
};