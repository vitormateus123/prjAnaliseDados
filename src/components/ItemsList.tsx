// src/components/ItemsList.tsx
// Fase 4: UI de lista de itens na tela de Revisão — adicionar, remover e
// editar cada item de um relatório com has_items=true (ex: cada produto
// identificado numa foto de prateleira).
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import * as Crypto from 'expo-crypto';
import { Ionicons } from '@expo/vector-icons';
import { ReportItem } from '../types/reports';
import { emptyFieldValue, parseFieldValue } from '../utils/fieldValue';
import { FieldFocusHandler } from '../utils/scrollFieldIntoView';
import { DynamicFields } from './DynamicFields';
import { colors, radius, shadows, spacing } from '../theme';

interface ItemsListProps {
  items: ReportItem[];
  onChange: (items: ReportItem[]) => void;
  onFieldFocus?: FieldFocusHandler;
}

/** Novo item vazio, usando o primeiro item existente como molde de quais
 * campos um item deste template tem — sempre há pelo menos 1 item quando
 * has_items=true (ver emptyReportItem em utils/reportBuilder.ts). */
function emptyItemFrom(template: ReportItem): ReportItem {
  return {
    id: Crypto.randomUUID(),
    fields: template.fields.map((f) => ({
      ...f,
      field_value: emptyFieldValue(f.field_value.type),
      confidence: undefined,
      source: 'manual',
      was_edited: false,
    })),
  };
}

export function ItemsList({ items, onChange, onFieldFocus }: ItemsListProps) {
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
            onFieldFocus={onFieldFocus}
          />
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
});
