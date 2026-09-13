import { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { useFocusEffect } from '@react-navigation/native';
import { StorageService } from '../storage/StorageService';
import { syncPendingReports } from '../services/sync/SyncService';
import { styles } from '../styles';

export default function AjustesScreen() {
  const [isOnline, setIsOnline] = useState<boolean | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const refreshPending = useCallback(async () => {
    const pending = await StorageService.getPendingReports();
    setPendingCount(pending.length);
  }, []);

  useEffect(() => {
    // Estado inicial de conectividade
    NetInfo.fetch().then((state) => setIsOnline(!!state.isConnected));

    // Passa a refletir mudanças reais de rede (wifi ligando/desligando etc.)
    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsOnline(!!state.isConnected);
    });
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

  return (
    <View style={styles.containerWithPadding}>
      <View style={styles.header}>
        <Text style={styles.title}>Ajustes</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Status de conexão</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
          <View style={[styles.onlineDot, isOnline ? styles.onlineDotOn : styles.onlineDotOff]} />
          <Text style={{ fontSize: 16, color: '#0f172a' }}>
            {isOnline === null ? 'Verificando...' : isOnline ? 'Online' : 'Offline'}
          </Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Relatórios pendentes</Text>
        <Text style={styles.statsNumber}>{pendingCount}</Text>
      </View>

      <TouchableOpacity
        style={[styles.button, styles.buttonPrimary]}
        onPress={handleSync}
        disabled={syncing || pendingCount === 0 || !isOnline}
        activeOpacity={0.8}
      >
        <Text style={styles.buttonText}>
          {syncing ? 'Sincronizando...' : '🔄 Sincronizar agora'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}