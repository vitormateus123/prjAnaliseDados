import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { loadReports, ReportField, upsertReport as persistReport } from '../storage/reports';
import { styles } from '../styles';
import { ReportOrigin } from '../types';

export default function AjustesScreen() {
  const [isOnline, setIsOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    async function loadPending() {
      const reports = await loadReports();
      const count = reports.filter((item) => item.status === 'pendente').length;
      setPendingCount(count);
    }
    loadPending();
  }, []);

  async function handleSync() {
    setSyncing(true);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const reports = await loadReports();
    const updated = reports.map((item) => ({
      ...item,
      status: 'sincronizado' as const,
      syncAttempted: true,
    }));
    await Promise.all(updated.map((item) => upsertReport(item)));
    setSyncing(false);
    setPendingCount(0);
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
          <Text style={{ fontSize: 16, color: '#0f172a' }}>{isOnline ? 'Online' : 'Offline'}</Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Relatórios pendentes</Text>
        <Text style={styles.statsNumber}>{pendingCount}</Text>
      </View>

      <TouchableOpacity
        style={[styles.button, styles.buttonPrimary]}
        onPress={handleSync}
        disabled={syncing || pendingCount === 0}
        activeOpacity={0.8}
      >
        <Text style={styles.buttonText}>
          {syncing ? 'Sincronizando...' : '🔄 Sincronizar agora'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

async function upsertReport(item: {
  status: 'sincronizado';
  syncAttempted: boolean;
  id: string;
  createdAt: Date;
  origin: ReportOrigin;
  fields: ReportField[];
  isDraft: boolean;
}) {
  return persistReport(item);
}
