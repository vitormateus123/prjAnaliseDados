import { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, FlatList } from 'react-native';
import { useNavigation, useFocusEffect, NavigationProp } from '@react-navigation/native';
import { StorageService } from '../storage/StorageService';
import { Report } from '../types/reports';
import { styles } from '../styles';
import { RootStackParamList } from '../../App';

const STATUS_LABEL: Record<Report['status'], string> = {
  draft: '📝 Rascunho',
  pending_sync: '⏳ Pendente',
  synced: '✓ Sincronizado',
  error: '⚠️ Erro',
};

const STATUS_COLOR: Record<Report['status'], string> = {
  draft: '#475569',
  pending_sync: '#92400e',
  synced: '#065f46',
  error: '#991b1b',
};

function captureIcon(report: Report): string {
  const type = report.captures[0]?.type;
  if (type === 'voice') return '🎤';
  if (type === 'photo') return '📷';
  return '✍️';
}

export default function HistoricoScreen() {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshList = useCallback(async () => {
    const data = await StorageService.getAllReports();
    setReports([...data].reverse());
  }, []);

  useEffect(() => {
    refreshList().finally(() => setLoading(false));
  }, [refreshList]);

  // Recarrega sempre que a aba volta a ficar em foco (ex: após salvar na Revisão)
  useFocusEffect(
    useCallback(() => {
      refreshList();
    }, [refreshList]),
  );

  function handleOpenReport(report: Report) {
    navigation.navigate('Revisao', { reportId: report.id });
  }

  async function handleSyncReport(report: Report) {
    await StorageService.upsertReport({
      ...report,
      status: 'synced',
      synced_at: new Date().toISOString(),
    });
    refreshList();
  }

  async function handleDeleteReport(report: Report) {
    await StorageService.deleteReport(report.id);
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
          onPress={() => navigation.navigate('FormSelect')}
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
                  {item.form_template_name}
                </Text>
                <Text style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                  {captureIcon(item)} —{' '}
                  {new Date(item.created_at).toLocaleDateString('pt-BR')}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ fontSize: 12, fontWeight: '600', color: STATUS_COLOR[item.status] }}>
                  {STATUS_LABEL[item.status]}
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