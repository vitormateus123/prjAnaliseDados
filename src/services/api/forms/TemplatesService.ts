// src/services/api/forms/TemplatesService.ts
// Busca os formulários (FormTemplate) do backend, que por sua vez lê do
// Supabase. Mantém um cache local em AsyncStorage: se o dispositivo estiver
// offline na hora de abrir a lista de formulários, ainda é possível escolher
// um formulário já visto antes (mas a extração por IA continua exigindo
// conexão, isso é tratado em Captura.tsx).

import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiFetch } from '../apiClient';
import { FormTemplate } from '../../../types/forms';

const TEMPLATES_CACHE_KEY = 'campo_form_templates_cache_v1';

async function cacheTemplates(templates: FormTemplate[]): Promise<void> {
  try {
    await AsyncStorage.setItem(TEMPLATES_CACHE_KEY, JSON.stringify(templates));
  } catch {
    // cache é um bônus — se falhar em gravar, não deve quebrar o fluxo principal
  }
}

async function getCachedTemplates(): Promise<FormTemplate[]> {
  const raw = await AsyncStorage.getItem(TEMPLATES_CACHE_KEY);
  return raw ? JSON.parse(raw) : [];
}

export async function fetchFormTemplates(): Promise<{
  templates: FormTemplate[];
  fromCache: boolean;
}> {
  try {
    const templates = await apiFetch<FormTemplate[]>('/templates/');
    await cacheTemplates(templates);
    return { templates, fromCache: false };
  } catch {
    const cached = await getCachedTemplates();
    return { templates: cached, fromCache: true };
  }
}

export async function fetchFormTemplateById(id: string): Promise<FormTemplate | null> {
  try {
    const template = await apiFetch<FormTemplate>(`/templates/${id}`);
    return template;
  } catch {
    const cached = await getCachedTemplates();
    return cached.find((t) => t.id === id) ?? null;
  }
}
