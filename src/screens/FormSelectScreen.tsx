// src/screens/FormSelectScreen.tsx

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, FlatList,
  StyleSheet, SafeAreaView, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { fetchFormTemplates } from '../services/api/forms/TemplatesService';
import { FormTemplate } from '../types/forms';
import { RootStackParamList } from '../../App';

type NavProp = NativeStackNavigationProp<RootStackParamList>;

export function FormSelectScreen() {
  const navigation = useNavigation<NavProp>();
  const [templates, setTemplates] = useState<FormTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fromCache, setFromCache] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    const { templates: data, fromCache: cached } = await fetchFormTemplates();
    setTemplates(data);
    setFromCache(cached);
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
          <ActivityIndicator size="large" color="#2563eb" />
          <Text style={styles.loadingText}>Carregando formulários...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>Novo Relatório</Text>
        <Text style={styles.subtitle}>Escolha o tipo de formulário</Text>
        {fromCache && templates.length > 0 && (
          <Text style={styles.offlineNotice}>
            ⚠️ Sem conexão — mostrando a última lista salva
          </Text>
        )}
      </View>

      {templates.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyTitle}>
            {fromCache ? 'Sem conexão e nenhum formulário salvo ainda' : 'Nenhum formulário disponível'}
          </Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => load()} activeOpacity={0.8}>
            <Text style={styles.retryText}>Tentar de novo</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={templates}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.card}
              onPress={() => handleSelect(item)}
              activeOpacity={0.85}
            >
              <Text style={styles.cardTitle}>{item.name}</Text>
              {item.description && (
                <Text style={styles.cardDesc}>{item.description}</Text>
              )}
              <Text style={styles.cardFields}>
                {item.fields.length} campos
              </Text>
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  header: { padding: 24, paddingBottom: 12 },
  title: { fontSize: 28, fontWeight: '800', color: '#0f172a' },
  subtitle: { fontSize: 14, color: '#64748b', marginTop: 4 },
  offlineNotice: { fontSize: 12, color: '#92400e', marginTop: 8 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  loadingText: { marginTop: 12, fontSize: 14, color: '#64748b' },
  emptyTitle: { fontSize: 15, color: '#64748b', textAlign: 'center', marginBottom: 16 },
  retryButton: {
    backgroundColor: '#2563eb', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 10,
  },
  retryText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  list: { padding: 16, gap: 12 },
  card: {
    backgroundColor: '#fff', borderRadius: 14, padding: 20,
    borderWidth: 1, borderColor: '#e2e8f0',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  cardTitle: { fontSize: 17, fontWeight: '700', color: '#0f172a', marginBottom: 4 },
  cardDesc: { fontSize: 13, color: '#64748b', marginBottom: 8 },
  cardFields: { fontSize: 12, color: '#94a3b8' },
});
