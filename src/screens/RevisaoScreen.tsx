// src/screens/RevisaoScreen.tsx
// Migrada para os tipos novos (src/types/reports.ts) e para o StorageService.

import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ScrollView, Alert, SafeAreaView, ActivityIndicator, TextInput,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { RootStackParamList } from '../../App';
import { StorageService } from '../storage/StorageService';
import { Report, ReportItem } from '../types/reports';
import { DynamicFields } from '../components/DynamicFields';
import { ItemsList } from '../components/ItemsList';
import { parseFieldValue } from '../utils/fieldValue';
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
  const [newFieldLabel, setNewFieldLabel] = useState('');
  const [newFieldValue, setNewFieldValue] = useState('');

  useEffect(() => {
    StorageService.getReportById(reportId).then((found) => {
      setReport(found);
      setLoading(false);
    });
  }, [reportId]);

  if (loading || !report) return <LoadingOverlay visible message="Carregando..." />;

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
    setReport((prev) => prev ? { ...prev, fields: prev.fields.filter((field) => field.key !== key) } : prev);
  }

  function handleAddField() {
    const label = newFieldLabel.trim();
    if (!label) return;
    const keyBase = label.toLocaleLowerCase('pt-BR').normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'informacao';
    setReport((prev) => {
      if (!prev) return prev;
      const key = prev.fields.some((field) => field.key === keyBase) ? `${keyBase}_${Date.now()}` : keyBase;
      return {
        ...prev,
        fields: [...prev.fields, {
          form_field_id: null, key, label,
          field_value: { type: 'text', value: newFieldValue },
          source: 'manual', was_edited: true, dynamic_type: 'text',
        }],
      };
    });
    setNewFieldLabel('');
    setNewFieldValue('');
  }

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
      await StorageService.upsertReport(updated);
      navigation.navigate('Principal', { screen: 'Histórico' });
    } catch {
      Alert.alert('Erro', 'Não foi possível salvar. Tente novamente.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <LoadingOverlay visible={saving} message="Salvando..." />
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.eyebrow}>{(report.context_label ?? report.form_template_name ?? 'INFORMAÇÃO').toUpperCase()}</Text>
        <Text style={styles.title}>Confira os dados extraídos</Text>
        <Text style={styles.subtitle}>Revise, corrija se necessário e salve o relatório.</Text>

        {extractionFailed && (
          <View style={styles.warnBanner}>
            <Ionicons name="alert-circle" size={18} color={colors.dangerStrong} />
            <Text style={styles.warnBannerText}>
              Não foi possível extrair automaticamente — preencha os campos manualmente.
            </Text>
          </View>
        )}

        <View style={styles.card}>
          <DynamicFields
            fields={report.fields}
            onChange={handleChange}
            onRemove={handleRemoveField}
            showEmptyMessage={false}
          />
          <View style={styles.addFieldArea}>
            <Text style={styles.addFieldTitle}>Adicionar informação</Text>
            <TextInput style={styles.addFieldInput} value={newFieldLabel} onChangeText={setNewFieldLabel}
              placeholder="Nome da informação" placeholderTextColor={colors.textMuted} />
            <TextInput style={styles.addFieldInput} value={newFieldValue} onChangeText={setNewFieldValue}
              placeholder="Valor (opcional)" placeholderTextColor={colors.textMuted} />
            <TouchableOpacity style={styles.addFieldButton} onPress={handleAddField} disabled={!newFieldLabel.trim()}>
              <Text style={styles.addFieldButtonText}>Adicionar campo</Text>
            </TouchableOpacity>
          </View>
        </View>

        {report.items && report.items.length > 0 && (
          <ItemsList items={report.items} onChange={handleItemsChange} />
        )}

        <TouchableOpacity style={styles.button} onPress={handleSave} activeOpacity={0.88}>
          <Ionicons name="checkmark-circle" size={20} color={colors.textOnPrimary} />
          <Text style={styles.buttonText}>Salvar relatório</Text>
        </TouchableOpacity>
      </ScrollView>
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
  warnBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.dangerSoft, borderRadius: radius.md,
    padding: spacing.md, marginBottom: spacing.lg,
    borderLeftWidth: 3, borderLeftColor: colors.danger,
  },
  warnBannerText: { flex: 1, fontSize: 12, fontWeight: '600', color: colors.dangerStrong },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xl,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.lg,
    ...shadows.sm,
  },
  addFieldArea: { borderTopWidth: 1, borderTopColor: colors.border, marginTop: spacing.md, paddingTop: spacing.md, gap: spacing.sm },
  addFieldTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  addFieldInput: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 10, color: colors.textPrimary, fontSize: 14 },
  addFieldButton: { alignSelf: 'flex-start', backgroundColor: colors.primaryLight, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 9 },
  addFieldButtonText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  button: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.success, paddingVertical: spacing.lg,
    borderRadius: radius.lg, marginTop: spacing.md,
    ...shadows.md,
  },
  buttonText: { color: colors.textOnPrimary, fontSize: 16, fontWeight: '700' },
});
