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

// Resposta de POST /extract/auto — o app manda só a mídia, sem escolher
// template antes; a IA classifica (ou propõe um template novo) e já
// devolve os campos extraídos (ou itens, quando has_items=true).
export interface AutoExtractedField {
  key: string;
  value: string;
  confidence: number;
}

export interface AutoExtractedItem {
  fields: AutoExtractedField[];
}

export interface AutoExtractionResult {
  success: boolean;
  template_id: string;
  template_name: string;
  template_is_new: boolean;
  has_items: boolean;
  fields: AutoExtractedField[];
  items: AutoExtractedItem[];
  error?: string;
  provider?: string;
  model?: string;
}

// Um item dentro de um relatório com has_items=true (ex: cada produto
// identificado numa foto de prateleira). Mesma forma de Report.fields,
// só que aninhado por item — ver report_items/report_item_fields no backend.
export interface ReportItem {
  id: string;
  fields: ReportField[];
}

export interface Report {
  id: string;                  // UUID gerado localmente
  form_template_id: string;
  form_template_name: string;  // cache para exibição no histórico
  status: ReportStatus;
  fields: ReportField[];
  items: ReportItem[];         // só preenchido quando o template tem has_items=true
  captures: Capture[];
  created_at: string;
  updated_at: string;
  synced_at?: string;
  sync_error?: string;         // mensagem da última tentativa de sync que falhou
}