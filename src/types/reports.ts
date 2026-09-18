// src/types/reports.ts

import type { FieldType } from './forms';

export type ReportStatus = 'draft' | 'pending_sync' | 'synced' | 'error';
export type CaptureType = 'voice' | 'photo' | 'text' | 'manual';
export type FieldSource = 'ai' | 'manual' | 'ai_edited';

// Finalidade que o usuário escolhe antes de capturar, na captura automática
// — só orienta a IA (ver _AUTO_PROMPT no backend), não define campos nem
// funciona como template. 'OTHER' vem sempre acompanhado de customInstruction.
export type ExtractionPurpose =
  | 'STOCK_COUNT'
  | 'DOCUMENT_ANALYSIS'
  | 'REPORT'
  | 'SCENE_OBJECT_PERSON_ANALYSIS'
  | 'OTHER';

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

// De qual fonte um valor veio, quando a captura combinou mais de uma
// modalidade (ex: 2 fotos + um áudio na mesma captura) — só informativo,
// pra auditoria/revisão; não existe quando o campo é 'manual'.
export type InputSource = 'image' | 'audio' | 'text';

export interface ReportField {
  // Campos propostos/adicionados durante a revisão não precisam existir em
  // nenhum template. O template, quando existir, é apenas uma referência.
  form_field_id?: string | null;
  key: string;
  label: string;
  field_value: FieldValue;
  confidence?: number;        // 0-1, vindo da IA
  source: FieldSource;
  was_edited: boolean;
  input_source?: InputSource | null;
  dynamic_type?: FieldType;
}

export interface Capture {
  id: string;
  type: CaptureType;
  local_path?: string;        // caminho local (offline)
  file_url?: string;          // URL remota (após sync) — assinada, temporária, só pra exibir
  mime_type?: string;
  created_at: string;
  // Texto digitado (captures do tipo 'text') — persistido de verdade
  // desde a criação da capture, não só usado na hora da extração.
  text_content?: string;
  // Conteúdo do arquivo em base64, só usado para montar o payload de um
  // POST /reports/ (ver SyncService.attachCaptureData) — nunca gravado no
  // AsyncStorage local nem exibido; existe só de passagem até o backend
  // fazer upload e persistir a mídia de verdade no Storage.
  data?: string;
}

export interface ExtractionResult {
  success: boolean;
  fields: Array<{
    key: string;
    value: string;             // a IA retorna string; o app converte depois
    confidence: number;
  }>;
  error?: string;
  // true = vale a pena chamar de novo (ex: sobrecarga momentânea da IA)
  retryable?: boolean;
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
  source?: InputSource;
}

export interface AutoExtractedItem {
  fields: AutoExtractedField[];
}

// Campo sem template (structure_mode='dynamic') — carrega label/type
// próprios, já que não há form_field para consultá-los.
export interface DynamicExtractedField extends AutoExtractedField {
  label: string;
  type: FieldType;
}

export interface DynamicExtractedItem {
  fields: DynamicExtractedField[];
}

export interface AutoExtractionResult {
  success: boolean;
  // 'guided'  = a IA encaixou (ou completou) um form_template já
  //             cadastrado — usar template_id/fields/items.
  // 'dynamic' = nada do catálogo servia — a IA estruturou livremente,
  //             sem template — usar context_label/dynamic_fields/dynamic_items.
  structure_mode: 'guided' | 'dynamic';

  // ─── structure_mode === 'guided' ───
  template_id?: string;
  template_name?: string;
  has_items?: boolean;
  fields?: AutoExtractedField[];
  items?: AutoExtractedItem[];
  // Keys dos campos que a IA acabou de adicionar a um template EXISTENTE
  // porque percebeu que faltava algo essencial pro conteúdo capturado (ex:
  // nota fiscal sem "emissor"). Vazio quando o template já cobria bem o
  // conteúdo.
  new_field_keys?: string[];

  // ─── structure_mode === 'dynamic' ───
  context_label?: string;
  context_type?: string;
  dynamic_fields?: DynamicExtractedField[];
  dynamic_items?: DynamicExtractedItem[];

  error?: string;
  // true = vale a pena chamar /extract/auto de novo com a mesma mídia
  // (ex: sobrecarga momentânea da IA); false = tentar de novo sozinho
  // não resolve (ex: mídia ilegível).
  retryable?: boolean;
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
  form_template_id?: string | null;
  form_template_name?: string | null;  // cache para exibição no histórico
  context_label?: string | null;
  context_type?: string | null;
  // Finalidade escolhida pelo usuário antes de capturar (tela de Captura,
  // modo automático) — só contexto/auditoria, ver ExtractionPurpose acima.
  extraction_purpose?: ExtractionPurpose | null;
  extraction_custom_instruction?: string | null;
  status: ReportStatus;
  fields: ReportField[];
  items: ReportItem[];         // só preenchido quando o template tem has_items=true
  captures: Capture[];
  created_at: string;
  updated_at: string;
  synced_at?: string;
  sync_error?: string;         // mensagem da última tentativa de sync que falhou
}