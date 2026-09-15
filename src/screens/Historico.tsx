import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, ActivityIndicator,
  StyleSheet, SafeAreaView,
} from 'react-native';
import { useNavigation, useFocusEffect, NavigationProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { StorageService } from '../storage/StorageService';
import { fetchRemoteReports } from '../services/api/reports/ReportsService';
import { syncReport } from '../services/sync/SyncService';
import { NetworkError, ApiError } from '../services/api/apiClient';
import { Report } from '../types/reports';
import { RootStackParamList } from '../../App';
import { colors, radius, shadows, spacing } from '../theme';

const STATUS_LABEL: Record<Report['status'], string> = {
  draft: 'Rascunho',
  pending_sync: 'Pendente',
  synced: 'Sincronizado',
  error: 'Erro',
};

const STATUS_STYLE: Record<Report['status'], { bg: string; text: string; icon: keyof typeof Ionicons.glyphMap }> = {
  draft: { bg: '#eef0f5', text: '#475569', icon: 'document-text-outline' },
  pending_sync: { bg: colors.warningSoft, text: colors.warningStrong, icon: 'time-outline' },
  synced: { bg: colors.successSoft, text: colors.successStrong, icon: 'checkmark-circle' },
  error: { bg: colors.dangerSoft, text: colors.dangerStrong, icon: 'alert-circle' },
};

function captureMeta(report: Report): { icon: keyof typeof Ionicons.glyphMap; bg: string; color: string } {
  const type = report.captures[0]?.type;
  if (type === 'voice') return { icon: 'mic', bg: colors.primaryLight, color: colors.primary };
  if (type === 'photo') return { icon: 'camera', bg: colors.accentSoft, color: colors.accent };
  return { icon: 'create', bg: colors.infoSoft, color: colors.infoStrong };
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
      <View style={local.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={local.loadingText}>Carregando...</Text>
      </View>
    );
  }

  const pendingCount = reports.filter((r) => r.status === 'pending_sync' || r.status === 'error').length;

  const remoteErrorBanner = remoteError && (
    <View style={local.warningBanner}>
      <Ionicons name="cloud-offline-outline" size={16} color={colors.warningStrong} />
      <View style={{ flex: 1, marginLeft: spacing.sm }}>
        <Text style={local.warningTitle}>Não foi possível buscar os relatórios do servidor</Text>
        <Text style={local.warningDetail}>{remoteError}</Text>
      </View>
    </View>
  );

  const header = (
    <View style={local.hero}>
      <View>
        <Text style={local.heroEyebrow}>SEUS RELATÓRIOS</Text>
        <Text style={local.heroTitle}>Histórico</Text>
        {reports.length > 0 && (
          <Text style={local.heroSubtitle}>
            {reports.length} {reports.length === 1 ? 'relatório' : 'relatórios'}
            {pendingCount > 0 ? ` · ${pendingCount} aguardando sincronização` : ' · tudo em dia'}
          </Text>
        )}
      </View>
      <TouchableOpacity
        style={local.newButton}
        onPress={() => navigation.navigate('Captura')}
        activeOpacity={0.85}
      >
        <Ionicons name="add" size={20} color={colors.textOnPrimary} />
        <Text style={local.newButtonText}>Novo</Text>
      </TouchableOpacity>
    </View>
  );

  if (reports.length === 0) {
    return (
      <SafeAreaView style={local.safe}>
        {header}
        <View style={local.emptyState}>
          {remoteErrorBanner}
          <View style={local.emptyIconWrap}>
            <Ionicons name="folder-open-outline" size={36} color={colors.primary} />
          </View>
          <Text style={local.emptyTitle}>Nenhum relatório ainda</Text>
          <Text style={local.emptyText}>Toque em "Novo" para criar seu primeiro relatório.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={local.safe}>
      {header}
      <FlatList
        data={reports}
        keyExtractor={(item) => item.id}
        contentContainerStyle={local.list}
        onRefresh={() => refreshList(true)}
        refreshing={refreshing}
        ListHeaderComponent={remoteErrorBanner || undefined}
        renderItem={({ item }) => {
          const meta = captureMeta(item);
          const status = STATUS_STYLE[item.status];
          return (
            <TouchableOpacity
              style={local.card}
              onPress={() => handleOpenReport(item)}
              activeOpacity={0.9}
            >
              <View style={local.cardRow}>
                <View style={[local.captureIcon, { backgroundColor: meta.bg }]}>
                  <Ionicons name={meta.icon} size={20} color={meta.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={local.cardTitle} numberOfLines={1}>{item.form_template_name}</Text>
                  <Text style={local.cardDate}>
                    {new Date(item.created_at).toLocaleDateString('pt-BR', {
                      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                    })}
                  </Text>
                </View>
                <View style={[local.statusPill, { backgroundColor: status.bg }]}>
                  <Ionicons name={status.icon} size={12} color={status.text} />
                  <Text style={[local.statusText, { color: status.text }]}>{STATUS_LABEL[item.status]}</Text>
                </View>
              </View>

              {item.status === 'error' && item.sync_error && (
                <Text style={local.syncError} numberOfLines={2}>{item.sync_error}</Text>
              )}

              <View style={local.cardActions}>
                <TouchableOpacity
                  style={local.iconAction}
                  onPress={() => handleOpenReport(item)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="pencil-outline" size={16} color={colors.textSecondary} />
                  <Text style={local.iconActionText}>Editar</Text>
                </TouchableOpacity>

                {item.status !== 'synced' && (
                  <TouchableOpacity
                    style={local.iconAction}
                    onPress={() => handleSyncReport(item)}
                    activeOpacity={0.7}
                    disabled={syncingId === item.id}
                  >
                    {syncingId === item.id ? (
                      <ActivityIndicator size="small" color={colors.successStrong} />
                    ) : (
                      <>
                        <Ionicons name="sync-outline" size={16} color={colors.successStrong} />
                        <Text style={[local.iconActionText, { color: colors.successStrong }]}>Sincronizar</Text>
                      </>
                    )}
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={[local.iconAction, { marginRight: 0 }]}
                  onPress={() => handleDeleteReport(item)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="trash-outline" size={16} color={colors.danger} />
                  <Text style={[local.iconActionText, { color: colors.danger }]}>Excluir</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          );
        }}
      />
    </SafeAreaView>
  );
}

const local = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  loadingText: { marginTop: spacing.md, fontSize: 14, color: colors.textSecondary },
  hero: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
    paddingHorizontal: spacing.xxl, paddingTop: spacing.xl, paddingBottom: spacing.lg,
  },
  heroEyebrow: { fontSize: 11, fontWeight: '800', color: colors.primary, letterSpacing: 1.2 },
  heroTitle: { fontSize: 26, fontWeight: '800', color: colors.textPrimary, letterSpacing: -0.4, marginTop: 2 },
  heroSubtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 4, fontWeight: '500' },
  newButton: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.primary,
    borderRadius: radius.pill, paddingVertical: 10, paddingHorizontal: 16,
    ...shadows.sm,
  },
  newButtonText: { color: colors.textOnPrimary, fontWeight: '700', fontSize: 14, marginLeft: 4 },
  warningBanner: {
    flexDirection: 'row', backgroundColor: colors.warningSoft, borderRadius: radius.md,
    padding: spacing.md, marginHorizontal: spacing.xxl, marginBottom: spacing.md,
  },
  warningTitle: { fontSize: 12, fontWeight: '700', color: colors.warningStrong },
  warningDetail: { fontSize: 12, color: colors.warningStrong, marginTop: 2 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xxxl },
  emptyIconWrap: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: colors.primaryLight,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg,
  },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary, marginBottom: 6, textAlign: 'center' },
  emptyText: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  list: { paddingHorizontal: spacing.xxl, paddingBottom: spacing.xxxl, gap: spacing.md },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md,
    ...shadows.sm,
  },
  cardRow: { flexDirection: 'row', alignItems: 'center' },
  captureIcon: {
    width: 42, height: 42, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center', marginRight: spacing.md,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  cardDate: { fontSize: 12, color: colors.textMuted, marginTop: 2, fontWeight: '500' },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', borderRadius: radius.pill,
    paddingHorizontal: 10, paddingVertical: 5, gap: 4,
  },
  statusText: { fontSize: 11, fontWeight: '700' },
  syncError: { fontSize: 12, color: colors.dangerStrong, marginTop: spacing.sm },
  cardActions: {
    flexDirection: 'row', marginTop: spacing.md, paddingTop: spacing.md,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  iconAction: {
    flexDirection: 'row', alignItems: 'center', marginRight: spacing.lg, gap: 5,
  },
  iconActionText: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
});
