// src/screens/FormSelectScreen.tsx

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, FlatList,
  StyleSheet, SafeAreaView, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { fetchFormTemplates, TemplatesFailure } from '../services/api/forms/TemplatesService';
import { FormTemplate } from '../types/forms';
import { RootStackParamList } from '../../App';
import { colors, radius, shadows, spacing } from '../theme';

type NavProp = NativeStackNavigationProp<RootStackParamList>;

/** Três estados diferentes que antes viravam a mesma mensagem genérica. */
function describeEmpty(failure: TemplatesFailure | null): { title: string; detail?: string } {
  if (!failure) {
    return {
      title: 'Nenhum formulário disponível',
      detail: 'O servidor respondeu, mas não há formulários ativos cadastrados.',
    };
  }
  if (failure.kind === 'server') {
    return {
      title: `O servidor respondeu com erro ${failure.status}`,
      detail: failure.message,
    };
  }
  return {
    title: 'Não foi possível conectar ao servidor',
    detail: failure.message,
  };
}

export function FormSelectScreen() {
  const navigation = useNavigation<NavProp>();
  const [templates, setTemplates] = useState<FormTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [failure, setFailure] = useState<TemplatesFailure | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    const result = await fetchFormTemplates();
    setTemplates(result.templates);
    setFromCache(result.fromCache);
    setFailure(result.failure);
    isRefresh ? setRefreshing(false) : setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function handleSelect(template: FormTemplate) {
    navigation.navigate('Captura', { formTemplateId: template.id });
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Carregando formulários...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const empty = describeEmpty(failure);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>ESCOLHA UM MODELO</Text>
        <Text style={styles.title}>Novo Relatório</Text>
        <Text style={styles.subtitle}>Selecione o tipo de formulário para começar</Text>
        {fromCache && templates.length > 0 && (
          <View style={styles.offlineBanner}>
            <Ionicons name="cloud-offline-outline" size={14} color={colors.warningStrong} />
            <Text style={styles.offlineNotice}>Sem conexão — mostrando a última lista salva</Text>
          </View>
        )}
      </View>

      {templates.length === 0 ? (
        <View style={styles.centered}>
          <View style={styles.emptyIconWrap}>
            <Ionicons name="alert-circle-outline" size={30} color={colors.primary} />
          </View>
          <Text style={styles.emptyTitle}>{empty.title}</Text>
          {!!empty.detail && <Text style={styles.emptyDetail}>{empty.detail}</Text>}
          <TouchableOpacity style={styles.retryButton} onPress={() => load()} activeOpacity={0.85}>
            <Ionicons name="refresh" size={16} color={colors.textOnPrimary} />
            <Text style={styles.retryText}>Tentar de novo</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={templates}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.primary} />
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.card}
              onPress={() => handleSelect(item)}
              activeOpacity={0.88}
            >
              <View style={styles.cardIconWrap}>
                <Ionicons name={item.has_items ? 'layers-outline' : 'document-text-outline'} size={20} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{item.name}</Text>
                {item.description && (
                  <Text style={styles.cardDesc} numberOfLines={2}>{item.description}</Text>
                )}
                <Text style={styles.cardFields}>{item.fields.length} campos</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { padding: spacing.xxl, paddingBottom: spacing.md },
  eyebrow: { fontSize: 11, fontWeight: '800', color: colors.primary, letterSpacing: 1.2, marginBottom: 4 },
  title: { fontSize: 26, fontWeight: '800', color: colors.textPrimary, letterSpacing: -0.4 },
  subtitle: { fontSize: 14, color: colors.textSecondary, marginTop: 4, fontWeight: '500' },
  offlineBanner: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.md, gap: 6 },
  offlineNotice: { fontSize: 12, color: colors.warningStrong, fontWeight: '600' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  loadingText: { marginTop: spacing.md, fontSize: 14, color: colors.textSecondary },
  emptyIconWrap: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primaryLight,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg,
  },
  emptyTitle: {
    fontSize: 16, fontWeight: '700', color: colors.textPrimary, textAlign: 'center', marginBottom: 6,
  },
  emptyDetail: {
    fontSize: 13, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.lg,
  },
  retryButton: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.primary, paddingVertical: 12, paddingHorizontal: 22, borderRadius: radius.pill,
    ...shadows.sm,
  },
  retryText: { color: colors.textOnPrimary, fontWeight: '700', fontSize: 14 },
  list: { padding: spacing.xxl, paddingTop: spacing.sm, gap: spacing.md },
  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md,
    ...shadows.sm,
  },
  cardIconWrap: {
    width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.primaryLight,
    alignItems: 'center', justifyContent: 'center', marginRight: spacing.md,
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, marginBottom: 3 },
  cardDesc: { fontSize: 13, color: colors.textSecondary, marginBottom: 6, lineHeight: 18 },
  cardFields: { fontSize: 11, color: colors.textMuted, fontWeight: '600' },
});
