// src/services/api/apiClient.ts
import Constants from 'expo-constants';
import { supabase } from '../auth/supabaseClient';

const ENV_URL = process.env.EXPO_PUBLIC_API_URL;
const EXTRA_URL = Constants.expoConfig?.extra?.apiUrl as string | undefined;

function normalize(url: string): string {
  return url.replace(/\/+$/, '');
}

export const BASE_URL = normalize(ENV_URL ?? EXTRA_URL ?? 'http://localhost:8000');

if (!__DEV__ && !BASE_URL.startsWith('https://')) {
  throw new Error('EXPO_PUBLIC_API_URL deve usar HTTPS em produção.');
}

if (__DEV__) {
  console.log('[apiClient] BASE_URL =', BASE_URL);
  if (!ENV_URL && !EXTRA_URL) {
    console.warn(
      '[apiClient] EXPO_PUBLIC_API_URL não definida. Em dispositivo físico, ' +
        'localhost aponta para o próprio celular. Defina a URL no .env.',
    );
  }
}

const DEFAULT_TIMEOUT_MS = 15000;
export const UPLOAD_TIMEOUT_MS = 60000;
export const EXTRACTION_TIMEOUT_MS = 90000;

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export class NetworkError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = 'NetworkError';
  }
}

async function request(
  url: string,
  init: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session?.access_token) {
      throw new ApiError(401, 'Sessão expirada.');
    }

    const headers = new Headers(init.headers);
    if (!(init.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }
    headers.set('Authorization', `Bearer ${data.session.access_token}`);

    return await fetch(url, {
      ...init,
      headers,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (__DEV__) console.error('[apiClient] falha de rede', err);

    const isAbort =
      err instanceof Error &&
      (err.name === 'AbortError' || /cancel/i.test(err.message));

    throw new NetworkError(
      isAbort
        ? `O servidor demorou mais de ${timeoutMs / 1000}s para responder.`
        : 'Não foi possível conectar ao servidor.',
      err,
    );
  } finally {
    clearTimeout(timer);
  }
}

async function parseError(response: Response): Promise<never> {
  // Never expose backend internals verbatim to the UI.
  const status = response.status;
  if (__DEV__) {
    console.error('[apiClient] HTTP', status);
  }

  if (status === 401) {
    await supabase.auth.signOut();
    throw new ApiError(401, 'Sessão expirada. Faça login novamente.');
  }
  if (status === 403) {
    throw new ApiError(403, 'Acesso não autorizado.');
  }
  if (status === 413) {
    throw new ApiError(413, 'Arquivo ou solicitação muito grande.');
  }
  if (status >= 500) {
    throw new ApiError(500, 'O servidor encontrou um erro. Tente novamente.');
  }

  let message = 'Não foi possível concluir a solicitação.';
  try {
    const parsed = await response.json();
    if (typeof parsed?.detail === 'string' && parsed.detail.length < 180) {
      message = parsed.detail;
    }
  } catch {
    // Keep the generic message.
  }
  throw new ApiError(status, message);
}

export async function apiFetch<T>(
  path: string,
  options?: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const response = await request(
    `${BASE_URL}${path}`,
    options ?? {},
    timeoutMs,
  );

  if (!response.ok) await parseError(response);
  return response.json() as Promise<T>;
}

export async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  const response = await request(
    `${BASE_URL}${path}`,
    { method: 'POST', body: formData },
    UPLOAD_TIMEOUT_MS,
  );

  if (!response.ok) await parseError(response);
  return response.json() as Promise<T>;
}

export function warmUpBackend(): void {
  // Fire-and-forget: no plano free do Render, o backend "hiberna" apos um
  // tempo sem uso e a primeira requisicao real demora bem mais (cold start).
  // Chamar /health assim que o app abre comeca esse boot em paralelo, antes
  // de qualquer tela precisar de dados de verdade — nao aguarda a resposta
  // nem trata erro, pois nao bloqueia nada: e so um empurrao antecipado.
  fetch(`${BASE_URL}/health`).catch(() => {});
}

export async function checkHealth(): Promise<boolean> {
  try {
    // Health is intentionally public on the backend, but this helper is only
    // a diagnostic and does not establish an authenticated session.
    const response = await fetch(`${BASE_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
}
