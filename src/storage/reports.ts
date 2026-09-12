import AsyncStorage from '@react-native-async-storage/async-storage';
import { Report, ReportField, ReportStatus } from '../types';

const REPORTS_KEY = 'field_reports_v1';

export async function loadReports(): Promise<Report[]> {
  try {
    const raw = await AsyncStorage.getItem(REPORTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Report[];
    return parsed.map((report) => ({
      ...report,
      createdAt: new Date(report.createdAt),
    }));
  } catch (error) {
    console.warn('Erro ao carregar relatórios:', error);
    return [];
  }
}

export async function saveReports(reports: Report[]): Promise<void> {
  try {
    await AsyncStorage.setItem(REPORTS_KEY, JSON.stringify(reports));
  } catch (error) {
    console.warn('Erro ao salvar relatórios:', error);
  }
}

export async function upsertReport(report: Report): Promise<void> {
  const reports = await loadReports();
  const index = reports.findIndex((item) => item.id === report.id);
  if (index === -1) {
    reports.push(report);
  } else {
    reports[index] = report;
  }
  await saveReports(reports);
}

export { Report, ReportField, ReportStatus };