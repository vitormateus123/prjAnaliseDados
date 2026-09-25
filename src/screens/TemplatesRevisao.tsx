// src/screens/TemplatesRevisao.tsx
// Fase 5: tela simples pra revisar os templates que a IA propôs em
// /extract/auto (review_status='pending') — aprovar como estão, renomear,
// ou mesclar em um template já existente quando a IA duplicou algo.

import { useCallback, useState } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, TextInput,
  StyleSheet, SafeAreaView, ActivityIndicator, Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { KeyboardAvoidingScreen } from '../components/KeyboardAvoidingScreen';
import { FormTemplate } from '../types/forms';
import { fetchFormTemplates } from '../services/api/forms/TemplatesService';
import {
  fetchPendingTemplates, approveTemplate, renameTemplate, mergeTemplate,
} from '../services/api/forms/TemplatesAdminService';
import { ApiError, NetworkError } from '../services/api/apiClient';
import { colors, radius, shadows, spacing } from '../theme';

function describeError(err: unknown): string {
  if (err instanceof ApiError) return `Erro ${err.status}: ${err.message}`;
  if (err instanceof NetworkError) return err.message;
  return err instanceof Error ? err.message : 'Falha inesperada.';
}

export function TemplatesRevisaoScreen() {
  const [pending, setPending] = useState<FormTemplate[]>([]);
  const [allTemplates, setAllTemplates] = useState<FormTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Estado de edição inline: no máximo um template sendo renomeado ou
  // com o seletor de mesclagem aberto por vez.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [mergingId, setMergingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pendingResult, allResult] = await Promise.all([
        fetchPendingTemplates(),
        fetchFormTemplates(),
      ]);
      setPending(pendingResult);
      setAllTemplates(allResult.templates);
    } catch (err) {
      Alert.alert('Erro ao carregar', describeError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  function startRenaming(template: FormTemplate) {
    setRenamingId(template.id);
    setMergingId(null);
    setDraftName(template.name);
    setDraftDescription(template.description ?? '');
  }

  async function handleApprove(template: FormTemplate) {
    setBusyId(template.id);
    try {
      await approveTemplate(template.id);
      await load();
    } catch (err) {
      Alert.alert('Erro ao aprovar', describeError(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleSaveRename(template: FormTemplate) {
    if (!draftName.trim()) {
      Alert.alert('Nome obrigatório', 'O formulário precisa de um nome.');
      return;
    }
    setBusyId(template.id);
    try {
      await renameTemplate(template.id, {
        name: draftName.trim(),
        description: draftDescription.trim() || undefined,
      });
      setRenamingId(null);
      await load();
    } catch (err) {
      Alert.alert('Erro ao renomear', describeError(err));
    } finally {
      setBusyId(null);
    }
  }

  function handleConfirmMerge(template: FormTemplate, target: FormTemplate) {
    Alert.alert(
      'Mesclar formulário',
      `Mesclar "${template.name}" em "${target.name}"? Os relatórios que usam "${template.name}" passam a usar "${target.name}", e este template pendente é desativado. Isso não pode ser desfeito.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Mesclar',
          style: 'destructive',
          onPress: async () => {
            setBusyId(template.id);
            try {
              const message = await mergeTemplate(template.id, target.id);
              setMergingId(null);
              await load();
              if (message) Alert.alert('Mesclado', message);
            } catch (err) {
              Alert.alert('Erro ao mesclar', describeError(err));
            } finally {
              setBusyId(null);
            }
          },
        },
      ],
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Carregando formulários pendentes...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingScreen>
      <View style={styles.header}>
        <Text style={{ fontSize: 11, fontWeight: '800', color: colors.primary, letterSpacing: 1.2, marginBottom: 4 }}>
          REVISÃO DE IA
        </Text>
        <Text style={styles.title}>Formulários pendentes</Text>
        <Text style={styles.subtitle}>
          Propostos automaticamente pela IA — revise antes que fiquem definitivos.
        </Text>
      </View>

      {pending.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyTitle}>Nenhum formulário pendente</Text>
          <Text style={styles.emptyDetail}>
            Formulários novos aparecem aqui quando a IA identifica um tipo de captura
            que ainda não existia.
          </Text>
        </View>
      ) : (
        <FlatList
          data={pending}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const isBusy = busyId === item.id;
            const isRenaming = renamingId === item.id;
            const isMerging = mergingId === item.id;
            const mergeOptions = allTemplates.filter((t) => t.id !== item.id);

            return (
              <View style={styles.card}>
                <View style={styles.cardHeaderRow}>
                  <Text style={styles.cardTitle}>{item.name}</Text>
                  {item.has_items && (
                    <View style={styles.itemsBadge}>
                      <Text style={styles.itemsBadgeText}>com itens</Text>
                    </View>
                  )}
                </View>
                {!!item.description && <Text style={styles.cardDesc}>{item.description}</Text>}
                <Text style={styles.cardFields}>
                  {item.fields.length} campo(s) — {item.fields.map((f) => f.label).join(', ')}
                </Text>

                {isRenaming ? (
                  <View style={{ marginTop: 12 }}>
                    <TextInput
                      style={styles.input}
                      value={draftName}
                      onChangeText={setDraftName}
                      placeholder="Nome do formulário"
                      placeholderTextColor="#94a3b8"
                    />
                    <TextInput
                      style={[styles.input, { marginTop: 8 }]}
                      value={draftDescription}
                      onChangeText={setDraftDescription}
                      placeholder="Descrição (opcional)"
                      placeholderTextColor="#94a3b8"
                    />
                    <View style={styles.actionsRow}>
                      <TouchableOpacity
                        style={[styles.actionButton, styles.actionSecondary]}
                        onPress={() => setRenamingId(null)}
                        disabled={isBusy}
                      >
                        <Text style={styles.actionTextSecondary}>Cancelar</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.actionButton, styles.actionPrimary]}
                        onPress={() => handleSaveRename(item)}
                        disabled={isBusy}
                      >
                        {isBusy ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <Text style={styles.actionText}>Salvar</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : isMerging ? (
                  <View style={{ marginTop: 12 }}>
                    <Text style={styles.sectionLabel}>Mesclar com:</Text>
                    {mergeOptions.length === 0 ? (
                      <Text style={styles.cardDesc}>Nenhum outro formulário disponível.</Text>
                    ) : (
                      mergeOptions.map((option) => (
                        <TouchableOpacity
                          key={option.id}
                          style={styles.mergeOption}
                          onPress={() => handleConfirmMerge(item, option)}
                          disabled={isBusy}
                          activeOpacity={0.8}
                        >
                          <Text style={styles.mergeOptionText}>{option.name}</Text>
                        </TouchableOpacity>
                      ))
                    )}
                    <TouchableOpacity
                      style={[styles.actionButton, styles.actionSecondary, { marginTop: 8 }]}
                      onPress={() => setMergingId(null)}
                      disabled={isBusy}
                    >
                      <Text style={styles.actionTextSecondary}>Cancelar</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={styles.actionsRow}>
                    <TouchableOpacity
                      style={[styles.actionButton, styles.actionSecondary]}
                      onPress={() => startRenaming(item)}
                      disabled={isBusy}
                    >
                      <Text style={styles.actionTextSecondary}>Renomear</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.actionButton, styles.actionSecondary]}
                      onPress={() => {
                        setMergingId(item.id);
                        setRenamingId(null);
                      }}
                      disabled={isBusy}
                    >
                      <Text style={styles.actionTextSecondary}>Mesclar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.actionButton, styles.actionPrimary]}
                      onPress={() => handleApprove(item)}
                      disabled={isBusy}
                    >
                      {isBusy ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.actionText}>Aprovar</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          }}
        />
      )}
      </KeyboardAvoidingScreen>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { padding: spacing.xxl, paddingBottom: spacing.md },
  title: { fontSize: 26, fontWeight: '800', color: colors.textPrimary, letterSpacing: -0.4 },
  subtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 4, lineHeight: 18 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  loadingText: { marginTop: spacing.md, fontSize: 14, color: colors.textSecondary },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, textAlign: 'center', marginBottom: 6 },
  emptyDetail: { fontSize: 13, color: colors.textSecondary, textAlign: 'center' },
  list: { padding: spacing.xxl, paddingTop: spacing.sm, gap: spacing.md, paddingBottom: spacing.xxxl },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.border, ...shadows.sm,
  },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, flexShrink: 1 },
  cardDesc: { fontSize: 13, color: colors.textSecondary, marginTop: 4 },
  cardFields: { fontSize: 12, color: colors.textMuted, marginTop: spacing.sm },
  itemsBadge: { backgroundColor: colors.primarySoft, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 2 },
  itemsBadgeText: { fontSize: 11, fontWeight: '700', color: colors.primaryDark },
  sectionLabel: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, marginBottom: 6 },
  input: {
    minHeight: 46, borderRadius: radius.sm, borderWidth: 1.5, borderColor: colors.border,
    backgroundColor: colors.surfaceAlt, paddingHorizontal: spacing.md, fontSize: 14, color: colors.textPrimary,
  },
  actionsRow: { flexDirection: 'row', marginTop: spacing.md, gap: spacing.sm },
  actionButton: {
    flex: 1, height: 46, borderRadius: radius.sm, justifyContent: 'center', alignItems: 'center',
  },
  actionPrimary: { backgroundColor: colors.primary },
  actionSecondary: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
  actionText: { fontSize: 13, fontWeight: '700', color: colors.textOnPrimary },
  actionTextSecondary: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  mergeOption: {
    backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, paddingVertical: 10,
    paddingHorizontal: spacing.md, marginBottom: 6, borderWidth: 1, borderColor: colors.border,
  },
  mergeOptionText: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
});
