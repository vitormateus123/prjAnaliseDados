// src/utils/sanitize.ts
// Sanitização de tudo que o usuário digita (ou que a IA devolve) antes de
// virar estado, ir para o AsyncStorage ou para o backend.
//
// LIMITS espelha backend/app/core/sanitize.py — o backend é a barreira
// definitiva (recusa/normaliza de novo); aqui o objetivo é não deixar o
// usuário montar um dado que só vai falhar na sincronização.

export const LIMITS = {
  name: 120,            // nome de formulário / label de campo
  description: 500,     // descrição, dica de extração
  key: 64,              // key snake_case
  option: 100,          // uma opção de select/multiselect
  options: 50,          // opções por campo
  fieldValue: 10_000,   // valor textual de um campo
  userText: 10_000,     // texto digitado na captura
  customInstruction: 500,
  search: 100,
  email: 254,
  password: 128,
  photos: 6,            // fotos por captura (o backend aceita até 8)
  summaryFields: 100,   // campos enviados ao resumo/refinamento
  mediaBytes: 10 * 1024 * 1024,
  maxNumber: 1e15,      // |número| máximo (evita overflow/perda de precisão)
} as const;

// Controle (exceto \t \n \r) + invisíveis usados em "Trojan Source": zero-width
// space, BOM e marcas bidi. ZWJ/ZWNJ ficam (emojis compostos dependem deles).
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const INVISIBLE_RE = /[\u200B\u2060\uFEFF\u202A-\u202E\u2066-\u2069]/g;

/**
 * Limpeza leve, segura para rodar a CADA tecla (não apara nem colapsa
 * espaços — senão o usuário não conseguiria digitar "São Paulo").
 */
export function stripUnsafe(value: string, maxLength: number): string {
  return value
    .normalize('NFC')
    .replace(INVISIBLE_RE, '')
    .replace(CONTROL_RE, '')
    .slice(0, maxLength);
}

/**
 * Limpeza final, para o que vai ser salvo/enviado: remove caracteres
 * perigosos, apara e (em linha única) colapsa qualquer espaço/quebra em um
 * espaço. `multiline` preserva quebras (no máximo uma linha em branco).
 */
export function sanitizeText(
  value: string | null | undefined,
  maxLength: number,
  { multiline = false }: { multiline?: boolean } = {},
): string {
  if (!value) return '';
  const base = stripUnsafe(value, Number.MAX_SAFE_INTEGER);
  const cleaned = multiline
    ? base.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
    : base.replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, maxLength).trimEnd();
}

/**
 * 'Nº da Nota Fiscal' -> 'no_da_nota_fiscal'. Igual ao slugify_key do
 * backend (a key vira identificador de campo, então só [a-z0-9_]).
 */
export function toFieldKey(value: string, fallback = 'campo'): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, LIMITS.key)
    .replace(/_+$/, '');
  return slug || fallback;
}

/** Opções de select/multiselect: limpas, sem vazias nem repetidas. */
export function sanitizeOptions(options: readonly string[]): string[] {
  const clean = options
    .map((option) => sanitizeText(option, LIMITS.option))
    .filter(Boolean);
  return Array.from(new Set(clean)).slice(0, LIMITS.options);
}

/** Corta com reticências (só para exibição). */
export function truncateText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

// ─── login ─────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: string): string {
  return stripUnsafe(email, LIMITS.email).trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return email.length <= LIMITS.email && EMAIL_RE.test(email);
}