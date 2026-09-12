import { Text, View } from 'react-native';
import { ReportField } from '../types';
import { styles } from '../styles';

interface DynamicFieldsProps {
  fields: ReportField[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  showEmptyMessage?: boolean;
}

export function DynamicFields({
  fields,
  values,
  onChange,
  showEmptyMessage = false,
}: DynamicFieldsProps) {
  return (
    <View>
      {showEmptyMessage && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>
            Não foi possível extrair automaticamente.
          </Text>
          <Text style={{ fontSize: 12, color: '#991b1b' }}>
            Preencha manualmente os campos abaixo.
          </Text>
        </View>
      )}

      {fields.map((field) => {
        const isReadOnly = field.key === 'origem';
        const isNumeric = field.type === 'quantidade';

        return (
          <View key={field.key} style={styles.field}>
            <Text style={styles.label}>
              {field.label}
            </Text>
            <View style={[styles.input, isReadOnly && { backgroundColor: '#e2e8f0' }]}>
              <Text style={{ fontSize: 16, color: '#0f172a' }}>
                {values[field.key] ?? ''}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}