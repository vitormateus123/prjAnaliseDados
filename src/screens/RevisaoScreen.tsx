// src/screens/RevisaoScreen.tsx
// Migrada para os tipos novos (src/types/reports.ts) e para o StorageService.

import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ScrollView, Alert, SafeAreaView, ActivityIndicator,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { StorageService } from '../storage/StorageService';
import { Report, ReportItem } from '../types/reports';
import { DynamicFields } from '../components/DynamicFields';
import { ItemsList } from '../components/ItemsList';
import { parseFieldValue } from '../utils/fieldValue';

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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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

  async function handleSave() {
    if (!report) return;
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
        <Text style={styles.title}>Confira os dados extraídos</Text>
        <DynamicFields
          fields={report.fields}
          onChange={handleChange}
          showEmptyMessage={!!extractionFailed}
        />
        {report.items && report.items.length > 0 && (
          <ItemsList items={report.items} onChange={handleItemsChange} />
        )}
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