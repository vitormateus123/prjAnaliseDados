import {
  ActivityIndicator,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ReportField } from '../types/reports';
import { fieldValueToString } from '../utils/fieldValue';
import { FieldFocusHandler } from '../utils/scrollFieldIntoView';
import { styles } from '../styles';
import { colors } from '../theme';
import { ConfidenceBadge } from './ConfidenceBadge';

interface DynamicFieldsProps {
  fields: ReportField[];
  onChange: (key: string, rawValue: string) => void;
  onRemove?: (key: string) => void;
  onRegenerate?: (key: string) => void;  // pede à IA para re-extrair este campo
  regeneratingKey?: string | null;        // key do campo que está sendo refinado no momento
  showEmptyMessage?: boolean;
  // Rola o scroll/lista pai até o campo quando ele é focado, pra não ficar
  // escondido atrás do teclado. Opcional pra não quebrar quem ainda não
  // passa isso.
  onFieldFocus?: FieldFocusHandler;
}

export function DynamicFields({
  fields,
  onChange,
  onRemove,
  onRegenerate,
  regeneratingKey,
  showEmptyMessage = false,
  onFieldFocus,
}: DynamicFieldsProps) {
  return (
    <View>
      {showEmptyMessage && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>
            Não foi possível extrair automaticamente.
          </Text>

          <Text
            style={{
              fontSize: 12,
              color: colors.dangerStrong,
              marginTop: 2,
            }}
          >
            Preencha manualmente os campos abaixo.
          </Text>
        </View>
      )}

      {fields.map((field) => {
        const isFromAI =
          field.source === 'ai' ||
          field.source === 'ai_edited';

        const value = fieldValueToString(
          field.field_value,
        );

        /*
         * TextInput de uma linha no React Native NÃO quebra texto — ele
         * rola horizontalmente. Um limite de caracteres (ex: > 70) é uma
         * aproximação ruim: a largura real depende do device, da fonte e
         * dos caracteres em si, então valores mais curtos que o limite
         * ainda podem estourar a largura do campo e exigir arrastar.
         *
         * Em vez de adivinhar por tamanho, decidimos por TIPO: qualquer
         * campo cujo valor é texto livre (text, long_text, select,
         * multiselect) sempre quebra linha e cresce com o conteúdo — nunca
         * precisa de scroll horizontal. Tipos com formato curto e fixo
         * (number, decimal, date, boolean) continuam em uma linha, já que
         * nunca estouram a largura do campo.
         */
        const isMultiline =
          field.field_value.type === 'text' ||
          field.field_value.type === 'long_text' ||
          field.field_value.type === 'select' ||
          field.field_value.type === 'multiselect';

        const wasEdited = field.was_edited;

        return (
          <View
            key={field.key}
            style={styles.field}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                marginBottom: 8,
                gap: 8,
              }}
            >
              <Text
                style={[
                  styles.label,
                  {
                    marginBottom: 0,
                    flex: 1,
                  },
                ]}
              >
                {field.label}
              </Text>

              {isFromAI && (
                <ConfidenceBadge
                  confidence={field.confidence}
                />
              )}

              {wasEdited && (
                <Ionicons
                  name="create-outline"
                  size={13}
                  color={colors.textMuted}
                />
              )}

              {onRegenerate && (
                regeneratingKey === field.key ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <TouchableOpacity
                    onPress={() => onRegenerate(field.key)}
                    hitSlop={8}
                    disabled={!!regeneratingKey}
                    style={{ opacity: regeneratingKey ? 0.4 : 1 }}
                  >
                    <Ionicons
                      name="refresh-outline"
                      size={16}
                      color={colors.primary}
                    />
                  </TouchableOpacity>
                )
              )}

              {onRemove && (
                <TouchableOpacity
                  onPress={() =>
                    onRemove(field.key)
                  }
                  hitSlop={8}
                  disabled={!!regeneratingKey}
                  style={{ opacity: regeneratingKey ? 0.4 : 1 }}
                >
                  <Ionicons
                    name="trash-outline"
                    size={16}
                    color={colors.danger}
                  />
                </TouchableOpacity>
              )}
            </View>

            <TextInput
              value={value}
              onChangeText={(text) =>
                onChange(field.key, text)
              }
              multiline={isMultiline}
              scrollEnabled={false}
              onFocus={onFieldFocus}
              placeholder={field.label}
              placeholderTextColor={colors.textMuted}
              textAlignVertical={
                isMultiline
                  ? 'top'
                  : 'center'
              }
              onContentSizeChange={(event) => {
                if (!isMultiline) return;

                const height =
                  event.nativeEvent.contentSize
                    .height;

                // Base de 54 (mesma altura do input de uma linha) — cresce
                // só quando o conteúdo realmente precisa de mais espaço,
                // em vez de forçar 96px pra um valor curto como "São Paulo".
                event.currentTarget.setNativeProps({
                  style: {
                    height: Math.max(
                      54,
                      height + 24,
                    ),
                  },
                });
              }}
              style={[
                styles.input,

                isMultiline && {
                  minHeight: 54,
                  paddingTop: 12,
                  paddingBottom: 12,
                  textAlignVertical: 'top',
                },
              ]}
            />
          </View>
        );
      })}
    </View>
  );
}