import { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, FlatList, ActivityIndicator } from 'react-native';
import { useNavigation, useFocusEffect, NavigationProp } from '@react-navigation/native';
import { StorageService } from '../storage/StorageService';
import { fetchRemoteReports } from '../services/api/reports/ReportsService';
import { syncReport } from '../services/sync/SyncService';
import { NetworkError, ApiError } from '../services/api/apiClient';
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

function describeRemoteError(err: unknown): string {
  if (err instanceof NetworkError) return err.message;
  if (err instanceof ApiError) return `O servidor respondeu com erro ${err.status}: ${err.message}`;
  return err instanceof Error ? err.message : 'Falha desconhecida ao buscar relatórios do servidor.';
}

export default function HistoricoScreen() {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  // Antes esse erro era engolido em silêncio e a tela só mostrava o que já
  // estava local, sem nenhuma pista do porquê os dados do Supabase não
  // apareciam. Agora fica visível como um aviso no topo da lista.
  const [remoteError, setRemoteError] = useState<string | null>(null);

  const refreshList = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);

    const local = await StorageService.getAllReports();
    const localIds = new Set(local.map((r) => r.id));

    try {
      const remote = await fetchRemoteReports();
      const onlyRemote = remote.filter((r) => !localIds.has(r.id));
      for (const report of onlyRemote) {
        await StorageService.upsertReport(report);
      }
      setRemoteError(null);
    } catch (err) {
      if (__DEV__) console.error('[Historico] falha ao buscar relatórios remotos', err);
      setRemoteError(describeRemoteError(err));
    }

    const merged = await StorageService.getAllReports();
    setReports([...merged].reverse());
    isRefresh ? setRefreshing(false) : setLoading(false);
  }, []);

  useEffect(() => {
    refreshList();
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
    setSyncingId(report.id);
    await syncReport(report);
    setSyncingId(null);
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

  const remoteErrorBanner = remoteError && (
    <View
      style={{
        backgroundColor: '#fef3c7',
        borderRadius: 10,
        padding: 12,
        marginBottom: 12,
      }}
    >
      <Text style={{ fontSize: 12, fontWeight: '700', color: '#92400e' }}>
        Não foi possível buscar os relatórios do servidor
      </Text>
      <Text style={{ fontSize: 12, color: '#92400e', marginTop: 2 }}>{remoteError}</Text>
    </View>
  );

  if (reports.length === 0) {
    return (
      <View style={styles.emptyState}>
        {remoteErrorBanner}
        <Text style={styles.emptyTitle}>Nenhum relatório ainda</Text>
        <Text style={styles.emptyText}>Crie seu primeiro relatório abaixo.</Text>
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
      {remoteErrorBanner}

      {/* Botão de novo relatório sempre visível no topo — mesmo com lista cheia */}
      <TouchableOpacity
        style={[styles.button, styles.buttonPrimary, { marginBottom: 8 }]}
        onPress={() => navigation.navigate('FormSelect')}
        activeOpacity={0.8}
      >
        <Text style={styles.buttonText}>+ Novo relatório</Text>
      </TouchableOpacity>

      <FlatList
        data={reports}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: 32 }}
        onRefresh={() => refreshList(true)}
        refreshing={refreshing}
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
            {item.status === 'error' && item.sync_error && (
              <Text style={{ fontSize: 12, color: '#991b1b', marginTop: 6 }} numberOfLines={3}>
                {item.sync_error}
              </Text>
            )}
            <View style={{ flexDirection: 'row', marginTop: 12 }}>
              <TouchableOpacity
                style={[styles.actionButton, styles.actionSecondary, { marginRight: 8 }]}
                onPress={() => handleOpenReport(item)}
                activeOpacity={0.8}
              >
                <Text style={styles.actionTextSecondary}>Editar</Text>
              </TouchableOpacity>
              {item.status !== 'synced' && (
                <TouchableOpacity
                  style={[styles.actionButton, { backgroundColor: '#d1fae5', marginRight: 8 }]}
                  onPress={() => handleSyncReport(item)}
                  activeOpacity={0.8}
                  disabled={syncingId === item.id}
                >
                  {syncingId === item.id ? (
                    <ActivityIndicator size="small" color="#065f46" />
                  ) : (
                    <Text style={{ fontSize: 14, fontWeight: '700', color: '#065f46' }}>
                      Sincronizar
                    </Text>
                  )}
                </TouchableOpacity>
              )}
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