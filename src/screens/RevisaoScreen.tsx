// src/screens/RevisaoScreen.tsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ScrollView, Alert, SafeAreaView, ActivityIndicator, TextInput,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { RootStackParamList } from '../../App';
import { KeyboardAvoidingScreen } from '../components/KeyboardAvoidingScreen';
import { StorageService } from '../storage/StorageService';
import { Report, ReportField, ReportItem } from '../types/reports';
import { DynamicFields } from '../components/DynamicFields';
import { ItemsList } from '../components/ItemsList';
import { CaptureOriginCard } from '../components/CaptureOriginCard';
import { parseFieldValue } from '../utils/fieldValue';
import { purposeIcon, purposeLabel } from '../constants/extractionPurpose';
import { refineFields, toRefineTargetFields, RefineTargetField } from '../services/api/ai/RefineService';
import { summarizeReport } from '../services/api/ai/SummaryService';
import { openReportPdf } from '../services/pdf/ReportPdfService';
import { makeFieldFocusHandler } from '../utils/scrollFieldIntoView';
import { colors, radius, shadows, spacing } from '../theme';

function LoadingOverlay({ visible, message }: { visible: boolean; message: string }) {
  if (!visible) return null;
  return (
    <View style={styles.loadingOverlay}>
      <ActivityIndicator size="large" color={colors.success} />
      <Text style={styles.loadingText}>{message}</Text>
    </View>
  );
}

type NavProp = NativeStackNavigationProp<RootStackParamList>;
type RouteProp_ = RouteProp<RootStackParamList, 'Revisao'>;

export function RevisaoScreen() {
  const navigation = useNavigation<NavProp>();
  const route = useRoute<RouteProp_>();
  const { reportId, extractionFailed } = route.params;

  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Rola até o campo focado (título/valor de campo, item, etc) pra ele não
  // ficar escondido atrás do teclado — ver utils/scrollFieldIntoView.
  const scrollRef = useRef<ScrollView>(null);
  const onFieldFocus = useMemo(
    () => makeFieldFocusHandler(() => scrollRef.current),
    [],
  );
  const [exportingPdf, setExportingPdf] = useState(false);

  // Snapshot dos campos/itens tal como carregados, pra saber em handleSave
  // se algo mudou desde então — só vale a pena chamar a IA de novo pro
  // resumo (summarizeReport) quando o conteúdo realmente mudou; caso
  // contrário o ai_summary gerado na captura continua válido.
  const initialFieldsSnapshot = React.useRef<string | null>(null);

  // ─── estado de refinamento ────────────────────────────────────────────────
  // regeneratingKey: key do campo sendo refinado individualmente (null = nenhum)
  // isRefiningAll: "Regenerar tudo" em andamento
  const [regeneratingKey, setRegeneratingKey] = useState<string | null>(null);
  const [isRefiningAll, setIsRefiningAll] = useState(false);
  const isRefining = !!regeneratingKey || isRefiningAll;

  // ─── estado do formulário de adicionar campo ──────────────────────────────
  const [newFieldLabel, setNewFieldLabel] = useState('');
  const [newFieldValue, setNewFieldValue] = useState('');

  useEffect(() => {
    StorageService.getReportById(reportId).then((found) => {
      setReport(found);
      if (found) {
        initialFieldsSnapshot.current = JSON.stringify({ fields: found.fields, items: found.items });
      }
      setLoading(false);
    });
  }, [reportId]);

  if (loading || !report) return <LoadingOverlay visible message="Carregando..." />;

  // ─── handlers de edição ───────────────────────────────────────────────────

  function handleChange(key: string, rawValue: string) {
    setReport((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        fields: prev.fields.map((f) => {
          if (f.key !== key) return f;
          return {
            ...f,
            field_value: parseFieldValue(f.field_value.type, rawValue),
            was_edited: true,
            source: f.source === 'manual' ? 'manual' : 'ai_edited',
          };
        }),
      };
    });
  }

  function handleItemsChange(items: ReportItem[]) {
    setReport((prev) => (prev ? { ...prev, items } : prev));
  }

  function handleRemoveField(key: string) {
    setReport((prev) =>
      prev ? { ...prev, fields: prev.fields.filter((f) => f.key !== key) } : prev,
    );
  }

  // ─── adicionar campo manualmente ─────────────────────────────────────────

  function buildNewField(label: string, value: string): ReportField {
    const keyBase = label
      .toLocaleLowerCase('pt-BR')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '') || 'informacao';
    const key =
      (report?.fields ?? []).some((f) => f.key === keyBase)
        ? `${keyBase}_${Date.now()}`
        : keyBase;
    return {
      form_field_id: null,
      key,
      label,
      field_value: { type: 'text', value },
      source: 'manual',
      was_edited: true,
      dynamic_type: 'text',
    };
  }

  /** Adiciona o campo com valor manual (sem acionar a IA). */
  function handleAddField() {
    const label = newFieldLabel.trim();
    if (!label) return;
    const newField = buildNewField(label, newFieldValue);
    setReport((prev) => {
      if (!prev) return prev;
      return { ...prev, fields: [...prev.fields, newField] };
    });
    setNewFieldLabel('');
    setNewFieldValue('');
  }

  /** Adiciona o campo e imediatamente pede à IA para preenchê-lo. */
  async function handleAddFieldAndRefine() {
    const label = newFieldLabel.trim();
    if (!label) return;
    if (!report) return;

    // Verifica se há mídia disponível antes de continuar
    const hasSomeMedia = report.captures.some(
      (c) => c.type === 'photo' || c.type === 'voice' || c.type === 'text',
    );
    if (!hasSomeMedia) {
      Alert.alert(
        'Sem mídia original',
        'Não há captura original associada a este relatório para analisar.',
      );
      return;
    }

    const newField = buildNewField(label, '');
    // Adiciona o campo com valor vazio (placeholder enquanto a IA responde)
    setReport((prev) => {
      if (!prev) return prev;
      return { ...prev, fields: [...prev.fields, newField] };
    });
    setNewFieldLabel('');
    setNewFieldValue('');

    // Dispara refinamento para o campo recém-adicionado
    await runRefineForKey(newField, report);
  }

  // ─── handlers de refinamento ──────────────────────────────────────────────

  /**
   * Re-extrai um campo específico do relatório.
   * Chama /extract/refine com apenas aquele campo como alvo.
   */
  async function handleRegenerateField(key: string) {
    if (!report) return;
    if (isRefining) return;

    const targetField = report.fields.find((f) => f.key === key);
    if (!targetField) return;

    await runRefineForKey(targetField, report);
  }

  async function runRefineForKey(field: ReportField, currentReport: Report) {
    const target: RefineTargetField = {
      key: field.key,
      label: field.label,
      type: field.dynamic_type ?? field.field_value.type,
      // Reusa a dica original do template (se existir); cai no label só
      // quando o campo nunca teve extraction_hint (ex: dinâmico ou manual).
      extraction_hint: field.extraction_hint ?? field.label,
    };

    setRegeneratingKey(field.key);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

    try {
      const result = await refineFields(currentReport.captures, [target]);

      if (!result.success || result.fields.length === 0) {
        Alert.alert(
          'Não encontrado',
          result.error ?? 'A IA não encontrou esse dado na captura original.',
        );
        return;
      }

      const refined = result.fields.find((f) => f.key === field.key);
      if (!refined || !refined.value) {
        Alert.alert('Não encontrado', 'A IA não encontrou esse dado na captura original.');
        return;
      }

      setReport((prev) => {
        if (!prev) return prev;
        const exists = prev.fields.some((f) => f.key === field.key);
        if (exists) {
          return {
            ...prev,
            fields: prev.fields.map((f) => {
              if (f.key !== field.key) return f;
              return {
                ...f,
                field_value: parseFieldValue(f.field_value.type, refined.value),
                confidence: refined.confidence,
                source: 'ai' as const,
                was_edited: false,
              };
            }),
          };
        }
        // Campo novo (adicionado manualmente + IA): adiciona com valor preenchido
        return {
          ...prev,
          fields: [...prev.fields, {
            ...field,
            field_value: parseFieldValue('text', refined.value),
            confidence: refined.confidence,
            source: 'ai' as const,
            was_edited: false,
          }],
        };
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } finally {
      setRegeneratingKey(null);
    }
  }

  /**
   * Regenera todos os campos do relatório.
   * Pergunta se quer incluir campos editados manualmente.
   */
  async function handleRegenerateAll() {
    if (!report) return;
    if (isRefining) return;

    const manualFields = report.fields.filter(
      (f) => f.source === 'manual' || f.was_edited,
    );
    const hasManualEdits = manualFields.length > 0;

    const doRefine = async (includeManual: boolean) => {
      const fieldsToRefine = includeManual
        ? report.fields
        : report.fields.filter((f) => f.source !== 'manual' && !f.was_edited);

      if (fieldsToRefine.length === 0) {
        Alert.alert('Sem campos para regenerar', 'Todos os campos foram editados manualmente.');
        return;
      }

      setIsRefiningAll(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

      try {
        const result = await refineFields(
          report.captures,
          toRefineTargetFields(fieldsToRefine),
        );

        if (!result.success) {
          Alert.alert('Erro ao regenerar', result.error ?? 'Tente novamente em instantes.');
          return;
        }

        const refinedMap = new Map(result.fields.map((f) => [f.key, f]));

        setReport((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            fields: prev.fields.map((f) => {
              const refined = refinedMap.get(f.key);
              if (!refined) return f;
              // Só sobrescreve se a IA trouxe um valor
              if (!refined.value) return f;
              return {
                ...f,
                field_value: parseFieldValue(f.field_value.type, refined.value),
                confidence: refined.confidence,
                source: 'ai' as const,
                was_edited: false,
              };
            }),
          };
        });

        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      } finally {
        setIsRefiningAll(false);
      }
    };

    if (hasManualEdits) {
      Alert.alert(
        'Regenerar tudo',
        `Você editou ${manualFields.length} campo(s) manualmente. Quer incluí-los na regeneração?`,
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Manter edições manuais',
            onPress: () => void doRefine(false),
          },
          {
            text: 'Incluir tudo',
            style: 'destructive',
            onPress: () => void doRefine(true),
          },
        ],
      );
    } else {
      void doRefine(false);
    }
  }

  // ─── salvar ───────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!report) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setSaving(true);
    try {
      const updated: Report = {
        ...report,
        status: report.status === 'synced' ? 'synced' : 'pending_sync',
        updated_at: new Date().toISOString(),
      };

      // Campos/itens mudaram desde que a tela abriu (edição manual,
      // regeneração de campo, item adicionado/removido etc.) → o
      // ai_summary gerado na captura pode não refletir mais o conteúdo.
      // Best-effort: se falhar, mantém o resumo anterior em vez de apagar.
      const currentSnapshot = JSON.stringify({ fields: updated.fields, items: updated.items });
      if (currentSnapshot !== initialFieldsSnapshot.current) {
        const newSummary = await summarizeReport(updated);
        if (newSummary) updated.ai_summary = newSummary;
      }

      await StorageService.upsertReport(updated);
      navigation.navigate('Principal', { screen: 'Histórico' });
    } catch {
      Alert.alert('Erro', 'Não foi possível salvar. Tente novamente.');
    } finally {
      setSaving(false);
    }
  }

  // ─── visualizar PDF ───────────────────────────────────────────────────────

  /** Abre o PDF do que está na tela agora (inclui edições ainda não salvas) —
   * não depende de salvar antes. */
  async function handleExportPdf() {
    if (!report || exportingPdf) return;
    setExportingPdf(true);
    try {
      await openReportPdf(report);
    } catch (err) {
      Alert.alert(
        'Não foi possível gerar o PDF',
        err instanceof Error ? err.message : 'Tente novamente em instantes.',
      );
    } finally {
      setExportingPdf(false);
    }
  }

  // ─── render ───────────────────────────────────────────────────────────────

  const hasCaptures = report.captures.length > 0;
  const canRefine =
    hasCaptures &&
    report.captures.some(
      (c) =>
        c.type === 'text' ||
        (c.type !== 'manual' && (!!c.local_path || !!c.file_url)),
    );

  return (
    <SafeAreaView style={styles.safe}>
      <LoadingOverlay visible={saving} message="Salvando..." />
      <KeyboardAvoidingScreen>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.eyebrow}>
            {(report.context_label ?? report.form_template_name ?? 'INFORMAÇÃO').toUpperCase()}
          </Text>
          <Text style={styles.title}>Confira os dados extraídos</Text>
          <Text style={styles.subtitle}>Revise, corrija se necessário e salve o relatório.</Text>

          {report.extraction_purpose && (
            <View style={styles.purposeBadge}>
              <Ionicons name={purposeIcon(report.extraction_purpose)} size={13} color={colors.textSecondary} />
              <Text style={styles.purposeBadgeText} numberOfLines={2}>
                Finalidade: {purposeLabel(report.extraction_purpose)}
                {report.extraction_custom_instruction ? ` — "${report.extraction_custom_instruction}"` : ''}
              </Text>
            </View>
          )}

          {extractionFailed && (
            <View style={styles.warnBanner}>
              <Ionicons name="alert-circle" size={18} color={colors.dangerStrong} />
              <Text style={styles.warnBannerText}>
                Não foi possível extrair automaticamente — preencha os campos manualmente.
              </Text>
            </View>
          )}

          {/* Botão "Regenerar tudo" */}
          {canRefine && (
            <TouchableOpacity
              style={[styles.regenerateAllButton, isRefiningAll && styles.regenerateAllButtonDisabled]}
              onPress={handleRegenerateAll}
              disabled={isRefining}
              activeOpacity={0.8}
            >
              {isRefiningAll ? (
                <>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={styles.regenerateAllText}>Analisando com IA…</Text>
                </>
              ) : (
                <>
                  <Ionicons name="refresh-circle-outline" size={18} color={colors.primary} />
                  <Text style={styles.regenerateAllText}>Regenerar tudo com IA</Text>
                </>
              )}
            </TouchableOpacity>
          )}

          <CaptureOriginCard captures={report.captures} />

          <View style={styles.card}>
            <DynamicFields
              fields={report.fields}
              onChange={handleChange}
              onRemove={handleRemoveField}
              onRegenerate={canRefine ? handleRegenerateField : undefined}
              regeneratingKey={regeneratingKey}
              showEmptyMessage={false}
              onFieldFocus={onFieldFocus}
            />

            {/* Seção "Adicionar informação" */}
            <View style={styles.addFieldArea}>
              <Text style={styles.addFieldTitle}>Adicionar informação</Text>
              <TextInput
                style={styles.addFieldInput}
                value={newFieldLabel}
                onChangeText={setNewFieldLabel}
                placeholder="Nome da informação"
                placeholderTextColor={colors.textMuted}
                editable={!isRefining}
                onFocus={onFieldFocus}
              />
              <TextInput
                style={styles.addFieldInput}
                value={newFieldValue}
                onChangeText={setNewFieldValue}
                placeholder="Valor (deixe vazio para a IA preencher)"
                placeholderTextColor={colors.textMuted}
                editable={!isRefining}
                onFocus={onFieldFocus}
              />
              <View style={styles.addFieldButtons}>
                <TouchableOpacity
                  style={[styles.addFieldButton, !newFieldLabel.trim() && styles.addFieldButtonDisabled]}
                  onPress={handleAddField}
                  disabled={!newFieldLabel.trim() || isRefining}
                >
                  <Ionicons name="add-circle-outline" size={15} color={colors.primary} />
                  <Text style={styles.addFieldButtonText}>Adicionar</Text>
                </TouchableOpacity>

                {canRefine && (
                  <TouchableOpacity
                    style={[
                      styles.addFieldButtonAI,
                      (!newFieldLabel.trim() || isRefining) && styles.addFieldButtonDisabled,
                    ]}
                    onPress={() => void handleAddFieldAndRefine()}
                    disabled={!newFieldLabel.trim() || isRefining}
                  >
                    {regeneratingKey === `_adding_${newFieldLabel}` ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : (
                      <Ionicons name="sparkles-outline" size={15} color={colors.primary} />
                    )}
                    <Text style={styles.addFieldButtonText}>IA preencher</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>

          {report.items && report.items.length > 0 && (
            <ItemsList items={report.items} onChange={handleItemsChange} onFieldFocus={onFieldFocus} />
          )}

          <TouchableOpacity
            style={[styles.exportButton, (isRefining || exportingPdf) && styles.buttonDisabled]}
            onPress={() => void handleExportPdf()}
            activeOpacity={0.85}
            disabled={isRefining || exportingPdf}
          >
            {exportingPdf ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Ionicons name="document-outline" size={20} color={colors.primary} />
            )}
            <Text style={styles.exportButtonText}>
              {exportingPdf ? 'Gerando PDF…' : 'Visualizar PDF'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, isRefining && styles.buttonDisabled]}
            onPress={handleSave}
            activeOpacity={0.88}
            disabled={isRefining}
          >
            <Ionicons name="checkmark-circle" size={20} color={colors.textOnPrimary} />
            <Text style={styles.buttonText}>Salvar relatório</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingScreen>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { padding: spacing.xxl, paddingBottom: spacing.xxxl * 1.5 },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 10,
    elevation: 10,
    backgroundColor: 'rgba(244, 245, 251, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: { marginTop: spacing.md, color: colors.textPrimary, fontSize: 16, fontWeight: '600' },
  eyebrow: { fontSize: 11, fontWeight: '800', color: colors.primary, letterSpacing: 1.2 },
  title: { fontSize: 22, fontWeight: '800', color: colors.textPrimary, marginTop: 4, letterSpacing: -0.3 },
  subtitle: { fontSize: 14, color: colors.textSecondary, marginTop: 4, marginBottom: spacing.xl },
  purposeBadge: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
    marginBottom: spacing.lg,
  },
  purposeBadgeText: { flex: 1, fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  warnBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.dangerSoft, borderRadius: radius.md,
    padding: spacing.md, marginBottom: spacing.lg,
    borderLeftWidth: 3, borderLeftColor: colors.danger,
  },
  warnBannerText: { flex: 1, fontSize: 12, fontWeight: '600', color: colors.dangerStrong },
  // ─── Botão "Regenerar tudo" ────────────────────────────────────────────────
  regenerateAllButton: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.primaryLight, borderRadius: radius.md,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
    marginBottom: spacing.lg,
    borderWidth: 1, borderColor: colors.border,
    alignSelf: 'flex-start',
  },
  regenerateAllButtonDisabled: { opacity: 0.5 },
  regenerateAllText: { fontSize: 13, fontWeight: '700', color: colors.primary },
  // ─── Card de campos ────────────────────────────────────────────────────────
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xl,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.lg,
    ...shadows.sm,
  },
  // ─── Seção adicionar campo ─────────────────────────────────────────────────
  addFieldArea: {
    borderTopWidth: 1, borderTopColor: colors.border,
    marginTop: spacing.md, paddingTop: spacing.md, gap: spacing.sm,
  },
  addFieldTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  addFieldInput: {
    backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 10,
    color: colors.textPrimary, fontSize: 14,
  },
  addFieldButtons: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  addFieldButton: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    alignSelf: 'flex-start', backgroundColor: colors.primaryLight,
    borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 9,
  },
  addFieldButtonAI: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    alignSelf: 'flex-start',
    backgroundColor: colors.primaryLight,
    borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 9,
    borderWidth: 1, borderColor: colors.primary,
  },
  addFieldButtonDisabled: { opacity: 0.4 },
  addFieldButtonText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  // ─── Botão salvar ──────────────────────────────────────────────────────────
  button: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.success, paddingVertical: spacing.lg,
    borderRadius: radius.lg, marginTop: spacing.md,
    ...shadows.md,
  },
  buttonDisabled: { opacity: 0.6 },
  exportButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.surface, paddingVertical: spacing.md,
    borderRadius: radius.lg, marginTop: spacing.md,
    borderWidth: 1.5, borderColor: colors.primary,
  },
  exportButtonText: { color: colors.primary, fontSize: 15, fontWeight: '700' },
  buttonText: { color: colors.textOnPrimary, fontSize: 16, fontWeight: '700' },
});