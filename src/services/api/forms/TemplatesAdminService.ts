// src/services/api/forms/TemplatesAdminService.ts
// Consumido pela TemplatesRevisaoScreen (Fase 5): lista os templates que a
// IA propôs em /extract/auto e ainda não foram revisados por um humano, e
// permite aprovar, renomear ou mesclar cada um em um template já existente.

import { apiFetch } from '../apiClient';
import { FormTemplate } from '../../../types/forms';

export async function fetchPendingTemplates(): Promise<FormTemplate[]> {
  return apiFetch<FormTemplate[]>('/templates/pending');
}

export async function approveTemplate(id: string): Promise<void> {
  await apiFetch(`/templates/${id}/approve`, { method: 'POST' });
}

export async function renameTemplate(
  id: string,
  changes: { name?: string; description?: string },
): Promise<FormTemplate> {
  return apiFetch<FormTemplate>(`/templates/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(changes),
  });
}

export async function mergeTemplate(id: string, targetTemplateId: string): Promise<string | undefined> {
  const result = await apiFetch<{ success: boolean; id: string; message?: string }>(
    `/templates/${id}/merge`,
    { method: 'POST', body: JSON.stringify({ target_template_id: targetTemplateId }) },
  );
  return result.message;
}