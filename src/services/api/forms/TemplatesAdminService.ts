// src/services/api/forms/TemplatesAdminService.ts
// Consumido pela TemplatesRevisaoScreen (Fase 5): lista os templates que a
// IA propôs em /extract/auto e ainda não foram revisados por um humano, e
// permite aprovar, renomear ou mesclar cada um em um template já existente.

import { apiFetch } from '../apiClient';
import { FormTemplate, FormField, FieldType } from '../../../types/forms';

export interface FieldInput {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  description?: string;
  extraction_hint?: string;
  options?: string[];
  is_item_field?: boolean;
}

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

/** Cria um formulário do zero — não passa pela fila de revisão da IA. */
export async function createTemplate(payload: {
  name: string;
  description?: string;
  has_items?: boolean;
  fields?: FieldInput[];
}): Promise<FormTemplate> {
  return apiFetch<FormTemplate>('/templates/', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** Adiciona um campo a um formulário já existente. */
export async function addField(templateId: string, field: FieldInput): Promise<FormField> {
  return apiFetch<FormField>(`/templates/${templateId}/fields`, {
    method: 'POST',
    body: JSON.stringify(field),
  });
}

/** Edita um campo (label, hint, opções etc.) sem afetar valores já salvos. */
export async function updateField(
  templateId: string,
  fieldId: string,
  changes: Partial<FieldInput>,
): Promise<FormField> {
  return apiFetch<FormField>(`/templates/${templateId}/fields/${fieldId}`, {
    method: 'PATCH',
    body: JSON.stringify(changes),
  });
}

/** Remove um campo. O backend recusa (409) se já houver valores preenchidos. */
export async function deleteField(templateId: string, fieldId: string): Promise<void> {
  await apiFetch(`/templates/${templateId}/fields/${fieldId}`, { method: 'DELETE' });
}