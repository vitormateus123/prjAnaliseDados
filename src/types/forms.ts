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
}

export interface FormTemplate {
  id: string;
  name: string;
  description?: string;
  version: number;
  active: boolean;
  fields: FormField[];        // sempre carregados junto
}