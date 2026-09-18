// src/services/api/apiClient.ts
import Constants from 'expo-constants';

/**
 * IMPORTANTE: a leitura precisa ser literalmente `process.env.EXPO_PUBLIC_API_URL`.
 * O babel-preset-expo substitui essa expressão exata pelo valor do .env em tempo
 * de build. Se você escrever `globalThis.process?.env?.EXPO_PUBLIC_API_URL`, o
 * padrão não é reconhecido, o valor vira `undefined` e a URL cai no fallback.
 */
const ENV_URL = process.env.EXPO_PUBLIC_API_URL;
const EXTRA_URL = Constants.expoConfig?.extra?.apiUrl as string | undefined;

function normalize(url: string): string {
  return url.replace(/\/+$/, ''); // remove barra final para não gerar '//templates/'
}

export const BASE_URL = normalize(ENV_URL ?? EXTRA_URL ?? 'http://localhost:8000');

if (__DEV__) {
  console.log('[apiClient] BASE_URL =', BASE_URL);
  if (!ENV_URL && !EXTRA_URL) {
    console.warn(
      '[apiClient] EXPO_PUBLIC_API_URL não definida. Em dispositivo físico, ' +
        'localhost aponta para o próprio celular e toda chamada vai falhar. ' +
        'Defina o IP da máquina no .env e rode `npx expo start -c`.',
    );
  }
}

const DEFAULT_TIMEOUT_MS = 15000;
// /extract/* passa por IA (Gemini/Groq) — isso sozinho já pode levar vários
// segundos. Some o "cold start" do plano gratuito do Render (o serviço
// dorme depois de ficar parado e pode levar 30-50s pra acordar na próxima
// chamada) e 15s corta a requisição bem no meio disso. Upload usa um
// timeout mais folgado por causa disso.
export const UPLOAD_TIMEOUT_MS = 60000;

/** Servidor respondeu, mas com status de erro. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Não houve resposta: DNS, rota, firewall, backend fora do ar, timeout. */
export class NetworkError extends Error {
  constructor(
    message: string,
    public cause?: unknown,
  ) {
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
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (__DEV__) console.error('[apiClient] falha de rede em', url, err);
    // No React Native, um fetch abortado por AbortController às vezes chega
    // aqui como "Fetch request has been canceled", não com name='AbortError'
    // — sem esse fallback, um timeout real era relatado como "não foi
    // possível conectar", escondendo a causa de verdade.
    const isAbort =
      err instanceof Error &&
      (err.name === 'AbortError' || /cancel/i.test(err.message));
    throw new NetworkError(
      isAbort
        ? `O servidor demorou mais de ${timeoutMs / 1000}s pra responder (${BASE_URL}). Se o backend estiver no plano gratuito do Render, ele pode estar "acordando" — tente de novo em alguns segundos.`
        : `Não foi possível conectar ao servidor (${BASE_URL}).`,
      err,
    );
  } finally {
    clearTimeout(timer);
  }
}

async function parseError(response: Response): Promise<never> {
  const text = await response.text();
  let message = text;
  try {
    const parsed = JSON.parse(text);
    if (parsed?.detail) message = parsed.detail;
  } catch {
    // corpo não é JSON — usa o texto cru mesmo
  }
  if (__DEV__) console.error('[apiClient] HTTP', response.status, message);
  throw new ApiError(response.status, message || `Erro ${response.status}`);
}

export async function apiFetch<T>(
  path: string,
  options?: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const response = await request(
    `${BASE_URL}${path}`,
    { ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } },
    timeoutMs,
  );

  if (!response.ok) await parseError(response);
  return response.json() as Promise<T>;
}

export async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  // Não defina Content-Type manualmente: o RN precisa gerar o boundary do multipart.
  const response = await request(
    `${BASE_URL}${path}`,
    { method: 'POST', body: formData },
    UPLOAD_TIMEOUT_MS,
  );

  if (!response.ok) await parseError(response);
  return response.json() as Promise<T>;
}

/** Usado pela tela de Ajustes para diagnosticar a conexão com o backend. */
export async function checkHealth(): Promise<boolean> {
  try {
    await apiFetch<{ status: string }>('/health');
    return true;
  } catch {
    return false;
  }
}