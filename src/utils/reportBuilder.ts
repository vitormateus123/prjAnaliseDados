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
  // Quando extractedFields é null, é preenchimento manual (offline/falha):
  // inclui todos os campos para o usuário preencher.
  if (extractedFields === null) {
    return fields.map((field) => ({
      form_field_id: field.id,
      key: field.key,
      label: field.label,
      field_value: emptyFieldValue(field.type),
      source: 'manual' as const,
      was_edited: false,
      extraction_hint: field.extraction_hint ?? null,
    }));
  }

  // Com extração da IA: inclui apenas campos que a IA conseguiu preencher.
  // Evita persistir campos vazios (ex: Código SKU) que não fazem sentido.
  return fields.flatMap((field) => {
    const found = extractedFields.find((ef) => ef.key === field.key);
    if (!found) return [];
    return [{
      form_field_id: field.id,
      key: field.key,
      label: field.label,
      field_value: parseFieldValue(field.type, found.value),
      confidence: found.confidence,
      source: 'ai' as const,
      was_edited: false,
      input_source: found.source ?? null,
      extraction_hint: field.extraction_hint ?? null,
    }];
  });
}

/** Item vazio para preenchimento manual — usado quando has_items=true mas a
 * IA não identificou nenhum item. Cria item SEM campos predefinidos;
 * o usuário adiciona campos conforme necessidade ("IA preencher" ou manual). */
export function emptyReportItem(_itemFields: FormField[]): ReportItem {
  return {
    id: Crypto.randomUUID(),
    fields: [],
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
    // Só inclui campos que a IA realmente preencheu para este item
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