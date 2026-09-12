// src/screens/RevisaoScreen.tsx
// REESCRITO: substitui RevisaoScreen.js que tinha import de store inexistente

import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ScrollView, Alert, SafeAreaView, ActivityIndicator,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { loadReports, saveReports } from '../storage/reports';
import { Report } from '../types';
import { DynamicFields } from '../components/DynamicFields';

function LoadingOverlay({ visible, message }: { visible: boolean; message: string }) {
  if (!visible) return null;

  return (
    <View style={styles.loadingOverlay}>
      <ActivityIndicator size="large" color="#16a34a" />
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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadReports().then((all) => {
      const found = all.find((r) => r.id === reportId) ?? null;
      setReport(found);
    });
  }, [reportId]);

  if (!report) return <LoadingOverlay visible message="Carregando..." />;

  // Extrai valores como Record<string, string> para o DynamicFieldForm
  const values: Record<string, string> = {};
  report.fields.forEach((f) => { values[f.key] = f.value; });

  function handleChange(key: string, value: string) {
    setReport((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        fields: prev.fields.map((f) =>
          f.key === key ? { ...f, value } : f
        ),
      };
    });
  }

  async function handleSave() {
    if (!report) return;
    setSaving(true);
    try {
      const reports = await loadReports();
      await saveReports(
        reports.map((item) =>
          item.id === report.id ? { ...report, status: 'pendente' } : item
        )
      );
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
        <Text style={styles.title}>Confira os dados extraídos</Text>
        <DynamicFields
          fields={report.fields}
          values={values}
          onChange={handleChange}
        />
        <TouchableOpacity style={styles.button} onPress={handleSave}>
          <Text style={styles.buttonText}>Salvar relatório</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  container: { padding: 24, paddingBottom: 48 },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 10,
    elevation: 10,
    backgroundColor: 'rgba(248, 250, 252, 0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: { marginTop: 12, color: '#0f172a', fontSize: 16 },
  title: { fontSize: 20, fontWeight: '700', color: '#0f172a', marginBottom: 20 },
  button: {
    backgroundColor: '#16a34a', paddingVertical: 16,
    borderRadius: 12, alignItems: 'center', marginTop: 20,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});