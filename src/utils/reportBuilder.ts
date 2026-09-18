// src/utils/reportBuilder.ts
// Monta ReportField[] / ReportItem[] a partir de um FormTemplate + do que a
// IA extraiu. Compartilhado entre o fluxo manual (Captura.tsx com
// formTemplateId já escolhido) e o fluxo automático (/extract/auto), pra não
// duplicar essa lógica nos dois lugares.
import * as Crypto from 'expo-crypto';
import { FormField } from '../types/forms';
import { DynamicExtractedField, ReportField, ReportItem } from '../types/reports';
import { emptyFieldValue, parseFieldValue } from './fieldValue';

interface ExtractedFieldLike {
  key: string;
  value: string;
  confidence: number;
  source?: 'image' | 'audio' | 'text';
}

export function buildReportFields(
  fields: FormField[],
  extractedFields: ExtractedFieldLike[] | null,
): ReportField[] {
  return fields.map((field) => {
    const found = extractedFields?.find((ef) => ef.key === field.key);
    if (found) {
      return {
        form_field_id: field.id,
        key: field.key,
        label: field.label,
        field_value: parseFieldValue(field.type, found.value),
        confidence: found.confidence,
        source: 'ai',
        was_edited: false,
        input_source: found.source ?? null,
      };
    }
    return {
      form_field_id: field.id,
      key: field.key,
      label: field.label,
      field_value: emptyFieldValue(field.type),
      source: 'manual',
      was_edited: false,
    };
  });
}

/** Item vazio pra preencher manualmente — usado quando has_items=true mas a
 * IA não identificou nenhum item, e como molde pra "+ Adicionar item". */
export function emptyReportItem(itemFields: FormField[]): ReportItem {
  return {
    id: Crypto.randomUUID(),
    fields: buildReportFields(itemFields, null),
  };
}

export function buildReportItems(
  itemFields: FormField[],
  extractedItems: Array<{ fields: ExtractedFieldLike[] }>,
): ReportItem[] {
  if (itemFields.length === 0) return [];
  if (extractedItems.length === 0) return [emptyReportItem(itemFields)];
  return extractedItems.map((it) => ({
    id: Crypto.randomUUID(),
    fields: buildReportFields(itemFields, it.fields),
  }));
}

// ─── modo dinâmico (/extract/auto com structure_mode='dynamic') ──────────
// Sem FormField/template por trás — cada campo já vem com sua própria
// label/type, direto da IA. form_field_id fica null (ver ReportField).

export function buildDynamicReportFields(
  extractedFields: DynamicExtractedField[],
): ReportField[] {
  return extractedFields.map((f) => ({
    form_field_id: null,
    key: f.key,
    label: f.label,
    field_value: parseFieldValue(f.type, f.value),
    confidence: f.confidence,
    source: 'ai',
    was_edited: false,
    input_source: f.source ?? null,
    dynamic_type: f.type,
  }));
}

export function buildDynamicReportItems(
  extractedItems: Array<{ fields: DynamicExtractedField[] }>,
): ReportItem[] {
  return extractedItems.map((it) => ({
    id: Crypto.randomUUID(),
    fields: buildDynamicReportFields(it.fields),
  }));
}