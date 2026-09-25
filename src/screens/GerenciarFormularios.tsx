// src/screens/GerenciarFormularios.tsx
// Tela de administração manual de formulários: criar um FormTemplate do
// zero e adicionar/editar/remover FormFields, sem depender da IA propor
// algo em /extract/auto primeiro (ver TemplatesRevisao.tsx pra esse outro
// fluxo). Fica acessível a partir de Ajustes.

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, TextInput,
  StyleSheet, SafeAreaView, ActivityIndicator, Alert, Switch,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { KeyboardAvoidingScreen } from '../components/KeyboardAvoidingScreen';
import { FormTemplate, FormField, FieldType } from '../types/forms';
import { fetchFormTemplates } from '../services/api/forms/TemplatesService';
import {
  createTemplate, addField, updateField, deleteField, FieldInput,
} from '../services/api/forms/TemplatesAdminService';
import { ApiError, NetworkError } from '../services/api/apiClient';
import { makeFieldFocusHandler } from '../utils/scrollFieldIntoView';
import { colors, radius, shadows, spacing } from '../theme';

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: 'text', label: 'Texto' },
  { value: 'long_text', label: 'Texto longo' },
  { value: 'number', label: 'Número' },
  { value: 'decimal', label: 'Decimal' },
  { value: 'date', label: 'Data' },
  { value: 'boolean', label: 'Sim/Não' },
  { value: 'select', label: 'Seleção única' },
  { value: 'multiselect', label: 'Seleção múltipla' },
];

const EMPTY_FIELD_DRAFT = {
  key: '', label: '', type: 'text' as FieldType,
  description: '', extraction_hint: '', options: '', required: false,
};
type FieldDraft = typeof EMPTY_FIELD_DRAFT;

function describeError(err: unknown): string {
  if (err instanceof ApiError) return `Erro ${err.status}: ${err.message}`;
  if (err instanceof NetworkError) return err.message;
  return err instanceof Error ? err.message : 'Falha inesperada.';
}

function draftToPayload(draft: FieldDraft): FieldInput {
  const isChoice = draft.type === 'select' || draft.type === 'multiselect';
  return {
    key: draft.key.trim(),
    label: draft.label.trim(),
    type: draft.type,
    required: draft.required,
    description: draft.description.trim() || undefined,
    extraction_hint: draft.extraction_hint.trim() || undefined,
    options: isChoice
      ? draft.options.split(',').map((o) => o.trim()).filter(Boolean)
      : undefined,
  };
}

export function GerenciarFormulariosScreen() {
  const [templates, setTemplates] = useState<FormTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Criação de formulário novo
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newHasItems, setNewHasItems] = useState(false);

  // Campo sendo adicionado (por template) ou editado (por campo)
  const [addingFieldFor, setAddingFieldFor] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<{ templateId: string; fieldId: string } | null>(null);
  const [fieldDraft, setFieldDraft] = useState<FieldDraft>(EMPTY_FIELD_DRAFT);

  // Rola a lista até o campo focado pra ele não ficar escondido atrás do
  // teclado — ver utils/scrollFieldIntoView.
  const listRef = useRef<FlatList>(null);
  const onFieldFocus = useMemo(
    () => makeFieldFocusHandler(() => listRef.current),
    [],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchFormTemplates();
      setTemplates(result.templates);
    } catch (err) {
      Alert.alert('Erro ao carregar', describeError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function toggleExpanded(id: string) {
    setExpandedId((current) => (current === id ? null : id));
    setAddingFieldFor(null);
    setEditingField(null);
  }

  async function handleCreateTemplate() {
    if (!newName.trim()) {
      Alert.alert('Nome obrigatório', 'Dê um nome ao formulário.');
      return;
    }
    setBusy(true);
    try {
      const created = await createTemplate({
        name: newName.trim(),
        description: newDescription.trim() || undefined,
        has_items: newHasItems,
      });
      setNewName('');
      setNewDescription('');
      setNewHasItems(false);
      setCreating(false);
      await load();
      setExpandedId(created.id); // já abre pra você adicionar os campos
    } catch (err) {
      Alert.alert('Erro ao criar formulário', describeError(err));
    } finally {
      setBusy(false);
    }
  }

  function startAddingField(templateId: string) {
    setEditingField(null);
    setAddingFieldFor(templateId);
    setFieldDraft(EMPTY_FIELD_DRAFT);
  }

  function startEditingField(templateId: string, field: FormField) {
    setAddingFieldFor(null);
    setEditingField({ templateId, fieldId: field.id });
    setFieldDraft({
      key: field.key,
      label: field.label,
      type: field.type,
      description: field.description ?? '',
      extraction_hint: field.extraction_hint ?? '',
      options: (field.options ?? []).join(', '),
      required: field.required,
    });
  }

  async function handleSaveNewField(templateId: string) {
    if (!fieldDraft.key.trim() || !fieldDraft.label.trim()) {
      Alert.alert('Campos obrigatórios', 'Preencha a key e o rótulo do campo.');
      return;
    }
    setBusy(true);
    try {
      await addField(templateId, draftToPayload(fieldDraft));
      setAddingFieldFor(null);
      await load();
    } catch (err) {
      Alert.alert('Erro ao adicionar campo', describeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveEditedField() {
    if (!editingField) return;
    if (!fieldDraft.key.trim() || !fieldDraft.label.trim()) {
      Alert.alert('Campos obrigatórios', 'Preencha a key e o rótulo do campo.');
      return;
    }
    setBusy(true);
    try {
      await updateField(editingField.templateId, editingField.fieldId, draftToPayload(fieldDraft));
      setEditingField(null);
      await load();
    } catch (err) {
      Alert.alert('Erro ao editar campo', describeError(err));
    } finally {
      setBusy(false);
    }
  }

  function handleDeleteField(templateId: string, field: FormField) {
    Alert.alert(
      'Remover campo',
      `Remover "${field.label}"? Só é possível se nenhum relatório já tiver um valor preenchido nele.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Remover',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await deleteField(templateId, field.id);
              await load();
            } catch (err) {
              Alert.alert('Não foi possível remover', describeError(err));
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }

  function renderFieldForm(templateId: string, onSave: () => void, onCancel: () => void) {
    const isChoice = fieldDraft.type === 'select' || fieldDraft.type === 'multiselect';
    return (
      <View style={styles.fieldForm}>
        <Text style={styles.formLabel}>Key (usada internamente, ex: numero_documento)</Text>
        <TextInput
          style={styles.input}
          value={fieldDraft.key}
          onChangeText={(t) => setFieldDraft((d) => ({ ...d, key: t }))}
          autoCapitalize="none"
          placeholder="numero_documento"
          placeholderTextColor={colors.textMuted}
          onFocus={onFieldFocus}
        />
        <Text style={styles.formLabel}>Rótulo (exibido na tela)</Text>
        <TextInput
          style={styles.input}
          value={fieldDraft.label}
          onChangeText={(t) => setFieldDraft((d) => ({ ...d, label: t }))}
          placeholder="Número do documento"
          placeholderTextColor={colors.textMuted}
          onFocus={onFieldFocus}
        />

        <Text style={styles.formLabel}>Tipo</Text>
        <View style={styles.chipRow}>
          {FIELD_TYPES.map((t) => (
            <TouchableOpacity
              key={t.value}
              style={[styles.chip, fieldDraft.type === t.value && styles.chipActive]}
              onPress={() => setFieldDraft((d) => ({ ...d, type: t.value }))}
            >
              <Text style={[styles.chipText, fieldDraft.type === t.value && styles.chipTextActive]}>
                {t.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {isChoice && (
          <>
            <Text style={styles.formLabel}>Opções (separadas por vírgula)</Text>
            <TextInput
              style={styles.input}
              value={fieldDraft.options}
              onChangeText={(t) => setFieldDraft((d) => ({ ...d, options: t }))}
              placeholder="Opção A, Opção B, Opção C"
              placeholderTextColor={colors.textMuted}
              onFocus={onFieldFocus}
            />
          </>
        )}

        <Text style={styles.formLabel}>Dica para a IA (extraction_hint, opcional)</Text>
        <TextInput
          style={styles.input}
          value={fieldDraft.extraction_hint}
          onChangeText={(t) => setFieldDraft((d) => ({ ...d, extraction_hint: t }))}
          placeholder="Identifique o número ou código oficial do documento."
          placeholderTextColor={colors.textMuted}
          multiline
          onFocus={onFieldFocus}
        />

        <View style={styles.switchRow}>
          <Text style={styles.formLabel}>Obrigatório</Text>
          <Switch
            value={fieldDraft.required}
            onValueChange={(v) => setFieldDraft((d) => ({ ...d, required: v }))}
            trackColor={{ true: colors.primary }}
          />
        </View>

        <View style={styles.formActions}>
          <TouchableOpacity style={styles.cancelButton} onPress={onCancel} disabled={busy}>
            <Text style={styles.cancelText}>Cancelar</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.saveButton} onPress={onSave} disabled={busy}>
            {busy ? (
              <ActivityIndicator size="small" color={colors.textOnPrimary} />
            ) : (
              <Text style={styles.saveText}>Salvar campo</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  function renderTemplate({ item }: { item: FormTemplate }) {
    const expanded = expandedId === item.id;
    return (
      <View style={styles.card}>
        <TouchableOpacity style={styles.cardHeader} onPress={() => toggleExpanded(item.id)} activeOpacity={0.85}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>{item.name}</Text>
            {!!item.description && <Text style={styles.cardDesc}>{item.description}</Text>}
            <Text style={styles.cardMeta}>{item.fields.length} campo(s){item.source === 'ai_generated' ? ' · proposto pela IA' : ''}</Text>
          </View>
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
        </TouchableOpacity>

        {expanded && (
          <View style={styles.cardBody}>
            {item.fields.map((field) => (
              <View key={field.id}>
                <View style={styles.fieldRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>{field.label}</Text>
                    <Text style={styles.fieldMeta}>
                      {field.key} · {FIELD_TYPES.find((t) => t.value === field.type)?.label ?? field.type}
                      {field.required ? ' · obrigatório' : ''}
                      {field.source === 'ai_generated' ? ' · sugerido pela IA' : ''}
                    </Text>
                  </View>
                  <TouchableOpacity style={styles.iconButton} onPress={() => startEditingField(item.id, field)}>
                    <Ionicons name="pencil-outline" size={16} color={colors.textSecondary} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.iconButton} onPress={() => handleDeleteField(item.id, field)}>
                    <Ionicons name="trash-outline" size={16} color={colors.danger} />
                  </TouchableOpacity>
                </View>
                {editingField?.templateId === item.id && editingField.fieldId === field.id &&
                  renderFieldForm(item.id, handleSaveEditedField, () => setEditingField(null))}
              </View>
            ))}

            {addingFieldFor === item.id ? (
              renderFieldForm(item.id, () => handleSaveNewField(item.id), () => setAddingFieldFor(null))
            ) : (
              <TouchableOpacity style={styles.addFieldButton} onPress={() => startAddingField(item.id)}>
                <Ionicons name="add" size={16} color={colors.primary} />
                <Text style={styles.addFieldText}>Adicionar campo</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingScreen>
      <FlatList
        ref={listRef}
        data={templates}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        onRefresh={load}
        refreshing={false}
        ListHeaderComponent={
          <View style={styles.header}>
            {creating ? (
              <View style={styles.newTemplateForm}>
                <Text style={styles.formLabel}>Nome do formulário</Text>
                <TextInput
                  style={styles.input}
                  value={newName}
                  onChangeText={setNewName}
                  placeholder="Levantamento de equipamentos"
                  placeholderTextColor={colors.textMuted}
                  onFocus={onFieldFocus}
                />
                <Text style={styles.formLabel}>Descrição (opcional)</Text>
                <TextInput
                  style={styles.input}
                  value={newDescription}
                  onChangeText={setNewDescription}
                  placeholder="Do que se trata esse formulário"
                  placeholderTextColor={colors.textMuted}
                  multiline
                  onFocus={onFieldFocus}
                />
                <View style={styles.switchRow}>
                  <Text style={styles.formLabel}>Tem itens repetidos (ex: lista de produtos)</Text>
                  <Switch value={newHasItems} onValueChange={setNewHasItems} trackColor={{ true: colors.primary }} />
                </View>
                <View style={styles.formActions}>
                  <TouchableOpacity style={styles.cancelButton} onPress={() => setCreating(false)} disabled={busy}>
                    <Text style={styles.cancelText}>Cancelar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.saveButton} onPress={handleCreateTemplate} disabled={busy}>
                    {busy ? (
                      <ActivityIndicator size="small" color={colors.textOnPrimary} />
                    ) : (
                      <Text style={styles.saveText}>Criar formulário</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity style={styles.newTemplateButton} onPress={() => setCreating(true)}>
                <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
                <Text style={styles.newTemplateText}>Novo formulário</Text>
              </TouchableOpacity>
            )}
          </View>
        }
        renderItem={renderTemplate}
      />
      </KeyboardAvoidingScreen>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: spacing.xxl, paddingTop: spacing.lg, gap: spacing.md },
  header: { marginBottom: spacing.md },
  newTemplateButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: colors.primaryLight, borderRadius: radius.md, paddingVertical: 12,
  },
  newTemplateText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  newTemplateForm: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.border, ...shadows.sm,
  },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md, ...shadows.sm,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  cardDesc: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  cardMeta: { fontSize: 11, color: colors.textMuted, marginTop: 4, fontWeight: '600' },
  cardBody: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border },
  fieldRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  fieldLabel: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  fieldMeta: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  iconButton: { padding: 6, marginLeft: 4 },
  addFieldButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: spacing.sm, marginTop: spacing.sm,
  },
  addFieldText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  fieldForm: { backgroundColor: colors.bg, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  formLabel: { fontSize: 11, fontWeight: '700', color: colors.textSecondary, marginBottom: 4, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.sm, paddingVertical: 8, fontSize: 13, color: colors.textPrimary,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 12, color: colors.textSecondary, fontWeight: '600' },
  chipTextActive: { color: colors.textOnPrimary },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.md },
  cancelButton: { paddingVertical: 10, paddingHorizontal: 16 },
  cancelText: { color: colors.textSecondary, fontWeight: '700', fontSize: 13 },
  saveButton: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: 18 },
  saveText: { color: colors.textOnPrimary, fontWeight: '700', fontSize: 13 },
});