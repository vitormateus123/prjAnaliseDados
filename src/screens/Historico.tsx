import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, FlatList } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { loadReports, upsertReport } from '../storage/reports';
import { Report } from '../types';
import { styles } from '../styles';

export default function HistoricoScreen() {
  const navigation = useNavigation();
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const data = await loadReports();
      setReports(data.reverse());
      setLoading(false);
    }
    load();
  }, []);

  async function refreshList() {
    const data = await loadReports();
    setReports(data.reverse());
  }

  function handleOpenReport(report: Report) {
    navigation.navigate('Revisão', { reportId: report.id } as never);
  }

  async function handleSyncReport(report: Report) {
    const updated = { ...report, status: 'sincronizado' as const, syncAttempted: true };
    await upsertReport(updated);
    refreshList();
  }

  async function handleDeleteReport(report: Report) {
    const reports = await loadReports();
    const filtered = reports.filter((item) => item.id !== report.id);
    await upsertReport(filtered);
    refreshList();
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>Carregando...</Text>
      </View>
    );
  }

  if (reports.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyTitle}>Nenhum relatório ainda</Text>
        <Text style={styles.emptyText}>Crie seu primeiro relatório na aba Captura.</Text>
        <TouchableOpacity
          style={[styles.button, styles.buttonPrimary]}
          onPress={() => navigation.navigate('Captura' as never)}
          activeOpacity={0.8}
        >
          <Text style={styles.buttonText}>+ Novo relatório</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.containerWithPadding}>
      <FlatList
        data={reports}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={undefined}
        onRefresh={refreshList}
        refreshing={loading}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => handleOpenReport(item)}
            activeOpacity={0.9}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, fontWeight: '600', color: '#0f172a' }}>
                  Relatório {item.id.slice(0, 8)}
                </Text>
                <Text style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                  {item.origin === 'voz' ? '🎤 Voz' : '📷 Foto'} —{' '}
                  {item.createdAt.toLocaleDateString('pt-BR')}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: '600',
                    color: item.status === 'sincronizado' ? '#065f46' : '#92400e',
                  }}
                >
                  {item.status === 'sincronizado' ? '✓ Sincronizado' : '⏳ Pendente'}
                </Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', marginTop: 12 }}>
              <TouchableOpacity
                style={[styles.actionButton, styles.actionSecondary, { marginRight: 8 }]}
                onPress={() => handleOpenReport(item)}
                activeOpacity={0.8}
              >
                <Text style={styles.actionTextSecondary}>Editar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: '#d1fae5', marginRight: 8 }]}
                onPress={() => handleSyncReport(item)}
                activeOpacity={0.8}
              >
                <Text style={{ fontSize: 14, fontWeight: '700', color: '#065f46' }}>
                  Sincronizar
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: '#fee2e2' }]}
                onPress={() => handleDeleteReport(item)}
                activeOpacity={0.8}
              >
                <Text style={{ fontSize: 14, fontWeight: '700', color: '#991b1b' }}>Excluir</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}
