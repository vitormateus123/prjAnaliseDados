// src/services/api/apiClient.ts
import Constants from 'expo-constants';

export const BASE_URL = (Constants.expoConfig?.extra?.apiUrl as string)
  ?? (globalThis as typeof globalThis & {
    process?: { env?: { EXPO_PUBLIC_API_URL?: string } };
  }).process?.env?.EXPO_PUBLIC_API_URL
  ?? 'http://localhost:8000';

export async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API error ${response.status}: ${text}`);
  }
  
  return response.json() as Promise<T>;
}

export async function apiUpload<T>(
  path: string,
  formData: FormData,
): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const response = await fetch(url, { method: 'POST', body: formData });
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Upload error ${response.status}: ${text}`);
  }
  
  return response.json() as Promise<T>;
}