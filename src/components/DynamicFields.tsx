import { Text, TextInput, View } from 'react-native';
import { ReportField } from '../types/reports';
import { fieldValueToString } from '../utils/fieldValue';
import { styles } from '../styles';
import { ConfidenceBadge } from './ConfidenceBadge';

interface DynamicFieldsProps {
  fields: ReportField[];
  onChange: (key: string, rawValue: string) => void;
  showEmptyMessage?: boolean;
}

export function DynamicFields({
  fields,
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
        const isFromAI = field.source === 'ai' || field.source === 'ai_edited';
        const isMultiline = field.field_value.type === 'long_text';

        return (
          <View key={field.key} style={styles.field}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
              <Text style={[styles.label, { marginBottom: 0, marginRight: 8 }]}>
                {field.label}
              </Text>
              {isFromAI && <ConfidenceBadge confidence={field.confidence} />}
            </View>
            <TextInput
              style={[styles.input, isMultiline && { minHeight: 96, textAlignVertical: 'top' }]}
              value={fieldValueToString(field.field_value)}
              onChangeText={(text) => onChange(field.key, text)}
              multiline={isMultiline}
              placeholder={field.label}
              placeholderTextColor="#94a3b8"
            />
          </View>
        );
      })}
    </View>
  );
}