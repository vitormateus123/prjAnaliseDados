import { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Alert, StyleSheet, SafeAreaView, ScrollView } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { useFocusEffect, useNavigation, NavigationProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { StorageService } from '../storage/StorageService';
import { syncPendingReports } from '../services/sync/SyncService';
import { processAllPendingExtractions } from '../services/extraction/AutoExtractQueueService';
import { supabase } from '../services/auth/supabaseClient';
import { unregisterPushToken } from '../services/api/devices/PushTokenService';
import { RootStackParamList } from '../../App';
import { colors, radius, shadows, spacing } from '../theme';
import { ExtractionStatus } from '../types/reports';

export default function AjustesScreen() {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const [isOnline, setIsOnline] = useState<boolean | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [extractionPendingCount, setExtractionPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [extracting, setExtracting] = useState(false);

  const refreshPending = useCallback(async () => {
    const pending = await StorageService.getPendingReports();
    setPendingCount(pending.length);

    // Conta também relatórios aguardando extração
    const allReports = await StorageService.getAllReports();
    const pendingExtraction = allReports.filter(
      (r) => r.extraction_status === 'pending' || r.extraction_status === 'processing'
    ).length;
    setExtractionPendingCount(pendingExtraction);
  }, []);

  useEffect(() => {
    NetInfo.fetch().then((state) => setIsOnline(!!state.isConnected));
    const unsubscribe = NetInfo.addEventListener((state) => setIsOnline(!!state.isConnected));
    return unsubscribe;
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshPending();
    }, [refreshPending]),
  );

  async function handleSync() {
    setSyncing(true);
    try {
      const result = await syncPendingReports();
      await refreshPending();
      if (result.failed > 0) {
        Alert.alert(
          'Sincronização parcial',
          `${result.success} relatório(s) sincronizado(s), ${result.failed} falharam.`,
        );
      } else if (result.success > 0) {
        Alert.alert('Sincronizado', `${result.success} relatório(s) sincronizado(s) com sucesso.`);
      } else {
        Alert.alert('Sem conexão', 'Não foi possível sincronizar. Verifique sua internet.');
      }
    } finally {
      setSyncing(false);
    }
  }

  async function handleRetryExtraction() {
    setExtracting(true);
    try {
      const result = await processAllPendingExtractions();
      await refreshPending();
      if (result.failed > 0) {
        Alert.alert(
          'Extração parcial',
          `${result.succeeded} relatório(s) extraído(s), ${result.failed} falharam.`,
        );
      } else if (result.succeeded > 0) {
        Alert.alert('Extração concluída', `${result.succeeded} relatório(s) processado(s) com sucesso.`);
      } else {
        Alert.alert('Nada a processar', 'Não há relatórios aguardando extração.');
      }
    } finally {
      setExtracting(false);
    }
  }

  async function handleLogout() {
    // Desativa o token deste aparelho ANTES de derrubar a sessão: o DELETE
    // /devices/push-token precisa do JWT. Sem isso, o aparelho continuaria
    // recebendo notificações caso outro usuário entre depois nesta conta.
    await unregisterPushToken();

    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) {
      Alert.alert('Não foi possível sair', 'Tente novamente.');
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>PREFERÊNCIAS</Text>
          <Text style={styles.title}>Ajustes</Text>
        </View>

        <View style={styles.statusRow}>
          <View style={[styles.statusCard, { flex: 1 }]}>
            <View style={styles.statusRowInner}>
              <View style={[styles.dot, isOnline ? styles.dotOn : styles.dotOff]} />
              <Text style={styles.statusLabel}>Conexão</Text>
            </View>
            <Text style={styles.statusValue}>
              {isOnline === null ? 'Verificando...' : isOnline ? 'Online' : 'Offline'}
            </Text>
          </View>

          <View style={[styles.statusCard, { flex: 1, marginLeft: spacing.md }]}>
            <View style={styles.statusRowInner}>
              <Ionicons name="cloud-upload-outline" size={14} color={colors.textSecondary} />
              <Text style={styles.statusLabel}>Pendentes</Text>
            </View>
            <Text style={[styles.statusValue, { color: colors.primary }]}>{pendingCount}</Text>
          </View>
        </View>

        <View style={styles.statusRow}>
          <View style={[styles.statusCard, { flex: 1 }]}>
            <View style={styles.statusRowInner}>
              <Ionicons name="sparkles-outline" size={14} color={colors.infoStrong} />
              <Text style={styles.statusLabel}>Aguardando extração</Text>
            </View>
            <Text style={[styles.statusValue, { color: colors.infoStrong }]}>{extractionPendingCount}</Text>
          </View>

          <View style={[styles.statusCard, { flex: 1, marginLeft: spacing.md }]}>
            <View style={styles.statusRowInner}>
              <Ionicons name="time-outline" size={14} color={colors.textSecondary} />
              <Text style={styles.statusLabel}>Total local</Text>
            </View>
            <Text style={styles.statusValue}>0</Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.actionCard, (syncing || pendingCount === 0 || !isOnline) && styles.actionCardDisabled]}
          onPress={handleSync}
          disabled={syncing || pendingCount === 0 || !isOnline}
          activeOpacity={0.85}
        >
          <View style={[styles.actionIconWrap, { backgroundColor: colors.primaryLight }]}>
            <Ionicons name="sync" size={20} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.actionTitle}>{syncing ? 'Sincronizando...' : 'Sincronizar agora'}</Text>
            <Text style={styles.actionDesc}>Envia os relatórios pendentes para o servidor</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionCard, (extracting || extractionPendingCount === 0 || !isOnline) && styles.actionCardDisabled]}
          onPress={handleRetryExtraction}
          disabled={extracting || extractionPendingCount === 0 || !isOnline}
          activeOpacity={0.85}
        >
          <View style={[styles.actionIconWrap, { backgroundColor: colors.infoSoft }]}>
            <Ionicons name="sparkles" size={20} color={colors.infoStrong} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.actionTitle}>{extracting ? 'Extraindo...' : 'Tentar extração agora'}</Text>
            <Text style={styles.actionDesc}>Processa relatórios aguardando extração por IA</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionCard}
          onPress={() => navigation.navigate('TemplatesRevisao')}
          activeOpacity={0.85}
        >
          <View style={[styles.actionIconWrap, { backgroundColor: colors.accentSoft }]}>
            <Ionicons name="albums-outline" size={20} color={colors.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.actionTitle}>Revisar formulários pendentes</Text>
            <Text style={styles.actionDesc}>Aprove ou ajuste modelos propostos pela IA</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionCard}
          onPress={() => navigation.navigate('GerenciarFormularios')}
          activeOpacity={0.85}
        >
          <View style={[styles.actionIconWrap, { backgroundColor: colors.primaryLight }]}>
            <Ionicons name="construct-outline" size={20} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.actionTitle}>Gerenciar formulários</Text>
            <Text style={styles.actionDesc}>Crie formulários e campos manualmente, sem depender da IA</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.logoutCard}
          onPress={handleLogout}
          activeOpacity={0.85}
        >
          <View style={styles.logoutIconWrap}>
            <Ionicons name="log-out-outline" size={20} color={colors.danger} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.logoutTitle}>Sair</Text>
            <Text style={styles.actionDesc}>Encerrar a sessão neste dispositivo</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { padding: spacing.xxl, paddingBottom: spacing.xxxl },
  header: { marginBottom: spacing.xl },
  eyebrow: { fontSize: 11, fontWeight: '800', color: colors.primary, letterSpacing: 1.2 },
  title: { fontSize: 26, fontWeight: '800', color: colors.textPrimary, marginTop: 2, letterSpacing: -0.4 },
  statusRow: { flexDirection: 'row', marginBottom: spacing.lg },
  statusCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.border, ...shadows.sm,
  },
  statusRowInner: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.sm },
  statusLabel: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
  statusValue: { fontSize: 20, fontWeight: '800', color: colors.textPrimary },
  dot: { width: 9, height: 9, borderRadius: 5 },
  dotOn: { backgroundColor: colors.success },
  dotOff: { backgroundColor: colors.danger },
  actionCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md,
    ...shadows.sm,
  },
  actionCardDisabled: { opacity: 0.55 },
  actionIconWrap: {
    width: 42, height: 42, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center', marginRight: spacing.md,
  },
  actionTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  actionDesc: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  logoutCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.dangerSoft, marginTop: spacing.xl,
    ...shadows.sm,
  },
  logoutIconWrap: {
    width: 42, height: 42, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center', marginRight: spacing.md,
    backgroundColor: colors.dangerSoft,
  },
  logoutTitle: { fontSize: 15, fontWeight: '700', color: colors.danger },
});