// src/types/reports.ts

export type ReportStatus = 'draft' | 'pending_sync' | 'synced' | 'error';
export type CaptureType = 'voice' | 'photo' | 'manual';
export type FieldSource = 'ai' | 'manual' | 'ai_edited';

// Representa um valor de campo — usa discriminated union para segurança de tipos
export type FieldValue =
  | { type: 'text'; value: string }
  | { type: 'long_text'; value: string }
  | { type: 'number'; value: number | null }
  | { type: 'decimal'; value: number | null }
  | { type: 'date'; value: string | null }    // ISO: 'YYYY-MM-DD'
  | { type: 'boolean'; value: boolean | null }
  | { type: 'select'; value: string | null }
  | { type: 'multiselect'; value: string[] };

export interface ReportField {
  form_field_id: string;
  key: string;
  label: string;
  field_value: FieldValue;
  confidence?: number;        // 0-1, vindo da IA
  source: FieldSource;
  was_edited: boolean;
}

export interface Capture {
  id: string;
  type: CaptureType;
  local_path?: string;        // caminho local (offline)
  file_url?: string;          // URL remota (após sync)
  mime_type?: string;
  created_at: string;
}

export interface ExtractionResult {
  success: boolean;
  fields: Array<{
    key: string;
    value: string;             // a IA retorna string; o app converte depois
    confidence: number;
  }>;
  error?: string;
  provider?: string;
  model?: string;
}

export interface Report {
  id: string;                  // UUID gerado localmente
  form_template_id: string;
  form_template_name: string;  // cache para exibição no histórico
  status: ReportStatus;
  fields: ReportField[];
  captures: Capture[];
  created_at: string;
  updated_at: string;
  synced_at?: string;
  sync_error?: string;         // mensagem da última tentativa de sync que falhou
}