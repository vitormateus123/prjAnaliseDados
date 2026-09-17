import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ReportField } from '../types/reports';
import { fieldValueToString } from '../utils/fieldValue';
import { styles } from '../styles';
import { colors } from '../theme';
import { ConfidenceBadge } from './ConfidenceBadge';

interface DynamicFieldsProps {
  fields: ReportField[];
  onChange: (key: string, rawValue: string) => void;
  onRemove?: (key: string) => void;
  showEmptyMessage?: boolean;
}

export function DynamicFields({
  fields,
  onChange,
  onRemove,
  showEmptyMessage = false,
}: DynamicFieldsProps) {
  return (
    <View>
      {showEmptyMessage && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>
            Não foi possível extrair automaticamente.
          </Text>
          <Text style={{ fontSize: 12, color: colors.dangerStrong, marginTop: 2 }}>
            Preencha manualmente os campos abaixo.
          </Text>
        </View>
      )}

      {fields.map((field) => {
        const isFromAI = field.source === 'ai' || field.source === 'ai_edited';
        const isMultiline = field.field_value.type === 'long_text';
        const wasEdited = field.was_edited;

        return (
          <View key={field.key} style={styles.field}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 8 }}>
              <Text style={[styles.label, { marginBottom: 0, flex: 1 }]}>{field.label}</Text>
              {isFromAI && <ConfidenceBadge confidence={field.confidence} />}
              {wasEdited && <Ionicons name="create-outline" size={13} color={colors.textMuted} />}
              {onRemove && (
                <TouchableOpacity onPress={() => onRemove(field.key)} hitSlop={8}>
                  <Ionicons name="trash-outline" size={16} color={colors.danger} />
                </TouchableOpacity>
              )}
            </View>
            <TextInput
              style={[styles.input, isMultiline && { minHeight: 96, textAlignVertical: 'top' }]}
              value={fieldValueToString(field.field_value)}
              onChangeText={(text) => onChange(field.key, text)}
              multiline={isMultiline}
              placeholder={field.label}
              placeholderTextColor={colors.textMuted}
            />
          </View>
        );
      })}
    </View>
  );
}
