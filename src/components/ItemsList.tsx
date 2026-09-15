// src/components/ItemsList.tsx
// Fase 4: UI de lista de itens na tela de Revisão — adicionar, remover e
// editar cada item de um relatório com has_items=true (ex: cada produto
// identificado numa foto de prateleira).
import { View, Text, TouchableOpacity } from 'react-native';
import * as Crypto from 'expo-crypto';
import { ReportItem } from '../types/reports';
import { emptyFieldValue, parseFieldValue } from '../utils/fieldValue';
import { DynamicFields } from './DynamicFields';
import { styles } from '../styles';

interface ItemsListProps {
  items: ReportItem[];
  onChange: (items: ReportItem[]) => void;
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

export function ItemsList({ items, onChange }: ItemsListProps) {
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
    <View style={{ marginBottom: 20 }}>
      <Text style={styles.sectionTitle}>Itens ({items.length})</Text>

      {items.map((item, idx) => (
        <View
          key={item.id}
          style={[styles.card, { borderWidth: 1, borderColor: '#e2e8f0', marginTop: 12 }]}
        >
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 4,
            }}
          >
            <Text style={{ fontSize: 15, fontWeight: '700', color: '#0f172a' }}>
              Item {idx + 1}
            </Text>
            {items.length > 1 && (
              <TouchableOpacity onPress={() => handleRemove(idx)} activeOpacity={0.7}>
                <Text style={{ color: '#dc2626', fontWeight: '700', fontSize: 13 }}>Remover</Text>
              </TouchableOpacity>
            )}
          </View>

          <DynamicFields
            fields={item.fields}
            onChange={(key, rawValue) => handleFieldChange(idx, key, rawValue)}
          />
        </View>
      ))}

      <TouchableOpacity
        style={[styles.button, styles.buttonSecondary, { marginTop: 12, height: 48 }]}
        onPress={handleAdd}
        activeOpacity={0.8}
      >
        <Text style={styles.buttonTextSecondary}>+ Adicionar item</Text>
      </TouchableOpacity>
    </View>
  );
}