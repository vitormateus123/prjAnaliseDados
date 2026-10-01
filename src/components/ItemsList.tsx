// src/components/ItemsList.tsx
// Fase 4: UI de lista de itens na tela de Revisão — adicionar, remover e
// editar cada item de um relatório com has_items=true (ex: cada produto
// identificado numa foto de prateleira).
import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, TextInput } from 'react-native';
import * as Crypto from 'expo-crypto';
import { Ionicons } from '@expo/vector-icons';
import { ReportField, ReportItem } from '../types/reports';
import { emptyFieldValue, parseFieldValue, fieldValueToString } from '../utils/fieldValue';
import { DynamicFields } from './DynamicFields';
import { colors, radius, shadows, spacing } from '../theme';

interface ItemsListProps {
  items: ReportItem[];
  onChange: (items: ReportItem[]) => void;
  canRefine?: boolean;
  onRemoveField?: (itemIndex: number, key: string) => void;
  onRegenerateField?: (itemIndex: number, key: string, field?: ReportField) => void;
  regeneratingKey?: string | null;
}

/** Novo item vazio, usando o primeiro item existente como molde de quais
 * campos um item deste template tem — sempre há pelo menos 1 item quando
 * has_items=true (ver emptyReportItem em utils/reportBuilder.ts). */
function emptyItemFrom(template: ReportItem): ReportItem {
  return {
    id: Crypto.randomUUID(),
    fields: template.fields
      .filter((f) => fieldValueToString(f.field_value).trim() !== '')
      .map((f) => ({
        ...f,
        field_value: emptyFieldValue(f.field_value.type),
        confidence: undefined,
        source: 'manual' as const,
        was_edited: false,
      })),
  };
}

export function ItemsList({
  items,
  onChange,
  canRefine = false,
  onRemoveField,
  onRegenerateField,
  regeneratingKey,
}: ItemsListProps) {
  const [newFieldLabels, setNewFieldLabels] = useState<Record<number, string>>({});
  const [newFieldValues, setNewFieldValues] = useState<Record<number, string>>({});

  function handleFieldChange(itemIndex: number, key: string, rawValue: string) {
    const updated = items.map((item, idx) => {
      if (idx !== itemIndex) return item;
      return {
        ...item,
        fields: item.fields.map((f) => {
          if (f.key !== key) return f;
          return {
            ...f,
            field_value: parseFieldValue(f.field_value.type, rawValue),
            was_edited: true,
            source: f.source === 'manual' ? 'manual' : 'ai_edited',
          } as typeof f;
        }),
      };
    });
    onChange(updated);
  }

  function handleRemove(itemIndex: number) {
    onChange(items.filter((_, idx) => idx !== itemIndex));
  }

  function handleAdd() {
    if (items.length === 0) return;
    onChange([...items, emptyItemFrom(items[0])]);
  }

  function handleRemoveField(itemIndex: number, key: string) {
    onRemoveField?.(itemIndex, key);
  }

  function handleRegenerateField(itemIndex: number, key: string) {
    onRegenerateField?.(itemIndex, key);
  }

  function handleAddField(itemIndex: number) {
    const label = (newFieldLabels[itemIndex] ?? '').trim();
    if (!label) return;
    const value = newFieldValues[itemIndex] ?? '';
    const updated = items.map((item, idx) => {
      if (idx !== itemIndex) return item;
      const keyBase = label
        .toLocaleLowerCase('pt-BR')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '') || 'informacao';
      const key = item.fields.some((f) => f.key === keyBase)
        ? `${keyBase}_${Date.now()}`
        : keyBase;
      const newField: ReportField = {
        form_field_id: null,
        key,
        label,
        field_value: { type: 'text', value },
        source: 'manual',
        was_edited: true,
        dynamic_type: 'text',
      };
      return {
        ...item,
        fields: [...item.fields, newField],
      };
    });
    onChange(updated);
    setNewFieldLabels((prev) => ({ ...prev, [itemIndex]: '' }));
    setNewFieldValues((prev) => ({ ...prev, [itemIndex]: '' }));
  }

  function handleAddFieldAndRefine(itemIndex: number) {
    const label = (newFieldLabels[itemIndex] ?? '').trim();
    if (!label) return;
    const updated = items.map((item, idx) => {
      if (idx !== itemIndex) return item;
      const keyBase = label
        .toLocaleLowerCase('pt-BR')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '') || 'informacao';
      const key = item.fields.some((f) => f.key === keyBase)
        ? `${keyBase}_${Date.now()}`
        : keyBase;
      const newField: ReportField = {
        form_field_id: null,
        key,
        label,
        field_value: { type: 'text', value: '' },
        source: 'manual',
        was_edited: true,
        dynamic_type: 'text',
      };
      return {
        ...item,
        fields: [...item.fields, newField],
      };
    });
    onChange(updated);
    setNewFieldLabels((prev) => ({ ...prev, [itemIndex]: '' }));
    setNewFieldValues((prev) => ({ ...prev, [itemIndex]: '' }));
    if (onRegenerateField && updated[itemIndex]) {
      const newField = updated[itemIndex].fields[updated[itemIndex].fields.length - 1];
      onRegenerateField(itemIndex, newField.key, newField);
    }
  }

  return (
    <View style={{ marginBottom: spacing.lg }}>
      <View style={local.sectionHeader}>
        <Ionicons name="layers-outline" size={16} color={colors.textSecondary} />
        <Text style={local.sectionTitle}>Itens ({items.length})</Text>
      </View>

      {items.map((item, idx) => (
        <View key={item.id} style={local.itemCard}>
          <View style={local.itemHeader}>
            <View style={local.itemBadge}>
              <Text style={local.itemBadgeText}>{idx + 1}</Text>
            </View>
            <Text style={local.itemTitle}>Item {idx + 1}</Text>
            {items.length > 1 && (
              <TouchableOpacity onPress={() => handleRemove(idx)} activeOpacity={0.7} style={local.removeButton}>
                <Ionicons name="trash-outline" size={14} color={colors.danger} />
                <Text style={local.removeText}>Remover</Text>
              </TouchableOpacity>
            )}
          </View>

          <DynamicFields
            fields={item.fields}
            onChange={(key, rawValue) => handleFieldChange(idx, key, rawValue)}
            onRemove={onRemoveField ? (key) => handleRemoveField(idx, key) : undefined}
            onRegenerate={canRefine && onRegenerateField ? (key) => handleRegenerateField(idx, key) : undefined}
            regeneratingKey={regeneratingKey}
            fieldKeyPrefix={`item_${idx}`}
          />

          <View style={local.addFieldArea}>
            <Text style={local.addFieldTitle}>Adicionar informação</Text>
            <TextInput
              style={local.addFieldInput}
              value={newFieldLabels[idx] ?? ''}
              onChangeText={(text) => setNewFieldLabels((prev) => ({ ...prev, [idx]: text }))}
              placeholder="Nome da informação"
              placeholderTextColor={colors.textMuted}
            />
            <TextInput
              style={local.addFieldInput}
              value={newFieldValues[idx] ?? ''}
              onChangeText={(text) => setNewFieldValues((prev) => ({ ...prev, [idx]: text }))}
              placeholder="Valor (deixe vazio para a IA preencher)"
              placeholderTextColor={colors.textMuted}
            />
            <View style={local.addFieldButtons}>
              <TouchableOpacity
                style={[local.addFieldButton, !(newFieldLabels[idx] ?? '').trim() && local.addFieldButtonDisabled]}
                onPress={() => handleAddField(idx)}
                disabled={!(newFieldLabels[idx] ?? '').trim()}
                activeOpacity={0.8}
              >
                <Ionicons name="add-circle-outline" size={15} color={colors.primary} />
                <Text style={local.addFieldButtonText}>Adicionar</Text>
              </TouchableOpacity>

              {canRefine && onRegenerateField && (
                <TouchableOpacity
                  style={[
                    local.addFieldButtonAI,
                    !(newFieldLabels[idx] ?? '').trim() && local.addFieldButtonDisabled,
                  ]}
                  onPress={() => handleAddFieldAndRefine(idx)}
                  disabled={!(newFieldLabels[idx] ?? '').trim()}
                  activeOpacity={0.8}
                >
                  <Ionicons name="sparkles-outline" size={15} color={colors.primary} />
                  <Text style={local.addFieldButtonText}>IA preencher</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      ))}

      <TouchableOpacity style={local.addButton} onPress={handleAdd} activeOpacity={0.85}>
        <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
        <Text style={local.addButtonText}>Adicionar item</Text>
      </TouchableOpacity>
    </View>
  );
}

const local = StyleSheet.create({
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.sm },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  itemCard: {
    backgroundColor: colors.surfaceAlt, borderRadius: radius.lg, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.border, marginTop: spacing.md,
  },
  itemHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md, gap: spacing.sm },
  itemBadge: {
    width: 22, height: 22, borderRadius: 11, backgroundColor: colors.primaryLight,
    alignItems: 'center', justifyContent: 'center',
  },
  itemBadgeText: { fontSize: 11, fontWeight: '800', color: colors.primary },
  itemTitle: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  removeButton: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  removeText: { color: colors.danger, fontWeight: '700', fontSize: 12 },
  addButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border, borderStyle: 'dashed',
    borderRadius: radius.md, marginTop: spacing.md, height: 48,
  },
  addButtonText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  // ─── seção adicionar campo ────────────────────────────────────────────────
  addFieldArea: {
    borderTopWidth: 1, borderTopColor: colors.border,
    marginTop: spacing.md, paddingTop: spacing.md, gap: spacing.sm,
  },
  addFieldTitle: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  addFieldInput: {
    backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 8,
    color: colors.textPrimary, fontSize: 13,
  },
  addFieldButtons: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  addFieldButton: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    alignSelf: 'flex-start', backgroundColor: colors.primaryLight,
    borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 8,
  },
  addFieldButtonAI: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    alignSelf: 'flex-start',
    backgroundColor: colors.primaryLight,
    borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 8,
    borderWidth: 1, borderColor: colors.primary,
  },
  addFieldButtonDisabled: { opacity: 0.4 },
  addFieldButtonText: { color: colors.primary, fontWeight: '700', fontSize: 12 },
});
