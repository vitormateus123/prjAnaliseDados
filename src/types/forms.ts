// src/types/forms.ts

export type FieldType =
  | 'text'
  | 'long_text'
  | 'number'
  | 'decimal'
  | 'date'
  | 'boolean'
  | 'select'
  | 'multiselect';

export interface FormField {
  id: string;
  key: string;                // ex: 'numero_documento'
  label: string;              // ex: 'Número do documento'
  type: FieldType;
  required: boolean;
  position: number;
  description?: string;       // texto de ajuda para o usuário
  extraction_hint?: string;   // instrução para a IA
  options?: string[];         // para select e multiselect
  validation_rules?: {
    min?: number;
    max?: number;
    pattern?: string;
  };
  // true = este campo se repete por item quando o template tem has_items=true
  // (ex: 'produto', 'quantidade'); false = campo único do relatório (ex: 'local').
  is_item_field?: boolean;
}

export type TemplateSource = 'manual' | 'ai_generated';
export type TemplateReviewStatus = 'pending' | 'approved' | 'rejected';

export interface FormTemplate {
  id: string;
  name: string;
  description?: string;
  version: number;
  active: boolean;
  fields: FormField[];        // sempre carregados junto
  // true = relatório desse tipo pode ter uma lista de itens (ver ReportItem
  // em types/reports.ts), além ou no lugar dos campos de nível de relatório.
  has_items?: boolean;
  // 'manual' = criado à mão; 'ai_generated' = proposto pela IA em /extract/auto.
  source?: TemplateSource;
  // 'pending' = ainda não revisado por um humano (mas já utilizável).
  review_status?: TemplateReviewStatus;
}