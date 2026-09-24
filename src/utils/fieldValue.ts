// src/utils/fieldValue.ts
// Converte entre o texto exibido/editado na UI e o FieldValue tipado
// (discriminated union) usado no armazenamento e na sincronização.

import { FieldType } from '../types/forms';
import { FieldValue } from '../types/reports';

export function emptyFieldValue(type: FieldType): FieldValue {
  switch (type) {
    case 'text':
      return { type: 'text', value: '' };
    case 'long_text':
      return { type: 'long_text', value: '' };
    case 'number':
      return { type: 'number', value: null };
    case 'decimal':
      return { type: 'decimal', value: null };
    case 'date':
      return { type: 'date', value: null };
    case 'boolean':
      return { type: 'boolean', value: null };
    case 'select':
      return { type: 'select', value: null };
    case 'multiselect':
      return { type: 'multiselect', value: [] };
  }
}

// Constrói um FieldValue a partir do texto bruto retornado pela IA
// (backend sempre devolve string) ou digitado manualmente pelo usuário.
export function parseFieldValue(type: FieldType, raw: string): FieldValue {
  const trimmed = raw.trim();

  switch (type) {
    case 'text':
      return { type: 'text', value: raw };
    case 'long_text':
      return { type: 'long_text', value: raw };
    case 'number': {
      const n = trimmed === '' ? null : parseInt(trimmed.replace(/\D/g, ''), 10);
      return { type: 'number', value: Number.isNaN(n as number) ? null : n };
    }
    case 'decimal': {
      const n = trimmed === '' ? null : Number(trimmed.replace(',', '.'));
      return { type: 'decimal', value: n === null || Number.isNaN(n) ? null : n };
    }
    case 'date':
      return { type: 'date', value: trimmed === '' ? null : trimmed };
    case 'boolean': {
      const normalized = trimmed.toLowerCase();
      const value =
        ['sim', 'true', 'verdadeiro', '1'].includes(normalized) ? true :
        ['não', 'nao', 'false', 'falso', '0'].includes(normalized) ? false :
        null;
      return { type: 'boolean', value };
    }
    case 'select':
      return { type: 'select', value: trimmed === '' ? null : raw };
    case 'multiselect':
      return {
        type: 'multiselect',
        value: trimmed === '' ? [] : trimmed.split(',').map((v) => v.trim()).filter(Boolean),
      };
  }
}

// Converte um FieldValue de volta para texto, para exibir em um TextInput.
export function fieldValueToString(fv: FieldValue): string {
  switch (fv.type) {
    case 'text':
    case 'long_text':
    case 'date':
      return fv.value ?? '';
    case 'number':
    case 'decimal':
      return fv.value === null || fv.value === undefined ? '' : String(fv.value);
    case 'boolean':
      return fv.value === null ? '' : fv.value ? 'sim' : 'não';
    case 'select':
      return fv.value ?? '';
    case 'multiselect':
      return fv.value.join(', ');
  }
}

// Converte um FieldValue para texto legível por pessoas (relatório em PDF,
// compartilhamento) — diferente de fieldValueToString, que devolve o formato
// editável de um TextInput ('sim'/'não', data ISO). Aqui: datas DD/MM/AAAA,
// booleanos "Sim"/"Não", decimais com vírgula. Devolve '' quando vazio.
export function fieldValueToDisplayString(fv: FieldValue): string {
  switch (fv.type) {
    case 'text':
    case 'long_text':
    case 'select':
      return (fv.value ?? '').trim();
    case 'number':
      return fv.value == null ? '' : String(fv.value);
    case 'decimal':
      return fv.value == null ? '' : String(fv.value).replace('.', ',');
    case 'date': {
      if (!fv.value) return '';
      const [y, m, d] = fv.value.split('-');
      return y && m && d ? `${d}/${m}/${y}` : fv.value;
    }
    case 'boolean':
      return fv.value == null ? '' : fv.value ? 'Sim' : 'Não';
    case 'multiselect':
      return fv.value.join(', ');
  }
}
