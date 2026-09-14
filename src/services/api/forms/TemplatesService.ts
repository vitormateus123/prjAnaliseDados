// src/services/api/forms/TemplatesService.ts
// Busca os formulários (FormTemplate) do backend, que por sua vez lê do
// Supabase. Mantém um cache local em AsyncStorage: se o dispositivo estiver
// offline na hora de abrir a lista de formulários, ainda é possível escolher
// um formulário já visto antes (mas a extração por IA continua exigindo
// conexão, isso é tratado em Captura.tsx).

import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiFetch, ApiError, NetworkError, BASE_URL } from '../apiClient';
import { FormTemplate } from '../../../types/forms';

const TEMPLATES_CACHE_KEY = 'campo_form_templates_cache_v1';

/** Por que a lista não veio do servidor. `null` = veio normalmente. */
export type TemplatesFailure =
  | { kind: 'network'; message: string }
  | { kind: 'server'; status: number; message: string };

export interface TemplatesResult {
  templates: FormTemplate[];
  fromCache: boolean;
  failure: TemplatesFailure | null;
}

async function cacheTemplates(templates: FormTemplate[]): Promise<void> {
  try {
    await AsyncStorage.setItem(TEMPLATES_CACHE_KEY, JSON.stringify(templates));
  } catch {
    // cache é um bônus — se falhar em gravar, não deve quebrar o fluxo principal
  }
}

async function getCachedTemplates(): Promise<FormTemplate[]> {
  try {
    const raw = await AsyncStorage.getItem(TEMPLATES_CACHE_KEY);
    return raw ? (JSON.parse(raw) as FormTemplate[]) : [];
  } catch {
    return []; // cache corrompido não deve derrubar a tela
  }
}

function toFailure(err: unknown): TemplatesFailure {
  if (err instanceof ApiError) {
    return { kind: 'server', status: err.status, message: err.message };
  }
  if (err instanceof NetworkError) {
    return { kind: 'network', message: err.message };
  }
  return {
    kind: 'network',
    message: err instanceof Error ? err.message : `Erro inesperado ao falar com ${BASE_URL}.`,
  };
}

export async function fetchFormTemplates(): Promise<TemplatesResult> {
  try {
    const templates = await apiFetch<FormTemplate[]>('/templates/');
    await cacheTemplates(templates);
    return { templates, fromCache: false, failure: null };
  } catch (err) {
    const failure = toFailure(err);
    const cached = await getCachedTemplates();
    return { templates: cached, fromCache: true, failure };
  }
}

export async function fetchFormTemplateById(id: string): Promise<FormTemplate | null> {
  try {
    return await apiFetch<FormTemplate>(`/templates/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    const cached = await getCachedTemplates();
    return cached.find((t) => t.id === id) ?? null;
  }
}