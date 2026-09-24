import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, SectionList, ActivityIndicator,
  StyleSheet, SafeAreaView, TextInput, ScrollView, Alert,
} from 'react-native';
import { useNavigation, useFocusEffect, NavigationProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { StorageService } from '../storage/StorageService';
import { fetchRemoteReports } from '../services/api/reports/ReportsService';
import { syncReport } from '../services/sync/SyncService';
import { openReportPdf } from '../services/pdf/ReportPdfService';
import { NetworkError, ApiError } from '../services/api/apiClient';
import { Report, ReportField, FieldValue } from '../types/reports';
import { purposeLabel } from '../constants/extractionPurpose';
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

type StatusFilter = 'all' | Report['status'];

// Ordem fixa da barra de filtros — "Todos" sempre primeiro, depois o que
// mais importa no dia a dia (o que falta sincronizar) antes do que já foi.
const FILTER_OPTIONS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'pending_sync', label: 'Pendente' },
  { key: 'error', label: 'Erro' },
  { key: 'draft', label: 'Rascunho' },
  { key: 'synced', label: 'Sincronizado' },
];

function captureMeta(report: Report): { icon: keyof typeof Ionicons.glyphMap; bg: string; color: string } {
  const type = report.captures[0]?.type;
  if (type === 'voice') return { icon: 'mic', bg: colors.primaryLight, color: colors.primary };
  if (type === 'photo') return { icon: 'camera', bg: colors.accentSoft, color: colors.accent };
  if (type === 'text') return { icon: 'create-outline', bg: colors.infoSoft, color: colors.infoStrong };
  return { icon: 'document-text-outline', bg: colors.infoSoft, color: colors.infoStrong };
}

function truncate(text: string, max = 40): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Converte um FieldValue (union discriminada) num texto curto pra exibir
 * — mesma lógica em todo lugar que mostra um valor, sem repetir por tipo. */
function fieldValueText(fv: FieldValue): string | null {
  switch (fv.type) {
    case 'text':
    case 'long_text':
    case 'select':
      return fv.value?.trim() ? truncate(fv.value.trim(), 44) : null;
    case 'number':
    case 'decimal':
      return fv.value != null ? String(fv.value) : null;
    case 'date': {
      if (!fv.value) return null;
      const [y, m, d] = fv.value.split('-');
      return d && m && y ? `${d}/${m}/${y}` : fv.value;
    }
    case 'boolean':
      return fv.value == null ? null : fv.value ? 'Sim' : 'Não';
    case 'multiselect':
      return fv.value.length ? truncate(fv.value.join(', '), 44) : null;
    default:
      return null;
  }
}

/** Mesma conversão acima, mas sem truncar — usada só na busca, pra não
 * perder um trecho do valor que ficou fora dos 40 caracteres de exibição. */
function fieldRawText(fv: FieldValue): string {
  switch (fv.type) {
    case 'text':
    case 'long_text':
    case 'select':
      return fv.value ?? '';
    case 'number':
    case 'decimal':
      return fv.value != null ? String(fv.value) : '';
    case 'date':
      return fv.value ?? '';
    case 'boolean':
      return fv.value == null ? '' : fv.value ? 'sim' : 'não';
    case 'multiselect':
      return fv.value.join(' ');
    default:
      return '';
  }
}

function fieldsRawText(fields: ReportField[]): string {
  return fields.map((f) => fieldRawText(f.field_value)).filter(Boolean).join(' ');
}

/** Remove acentos e caixa pra busca não depender de digitar exatamente
 * igual (ex: "endereco" tem que achar "endereço"). */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/** Todo texto de um relatório que faz sentido bater numa busca: título,
 * template, status, valores de campos (incluindo os de dentro de itens) e
 * o erro de sync, se houver. */
function reportSearchableText(report: Report): string {
  const parts = [
    report.context_label ?? '',
    report.form_template_name ?? '',
    STATUS_LABEL[report.status],
    fieldsRawText(report.fields),
    ...report.items.map((item) => fieldsRawText(item.fields)),
    report.sync_error ?? '',
  ];
  return normalize(parts.join(' '));
}

/** Campos do card — até 3 pares label/valor, na ordem em que foram
 * extraídos (que costuma colocar o mais identificador primeiro, tipo
 * número/nome). É o que diferencia duas capturas do mesmo tipo, já que o
 * título sozinho ("Nota Fiscal") é igual pras duas.
 *
 * Retornamos {label, value} em vez de string pronta: mostrar só o valor
 * ("42 · São Paulo") não diz o que é 42 nem o que é São Paulo — o rótulo é
 * o que deixa a extração reconhecível de relance, sem precisar abrir o
 * relatório pra entender (heurística de "reconhecimento em vez de
 * memorização" — a pessoa não precisa lembrar o que cada card contém). */
function reportFieldEntries(report: Report): { label: string; value: string }[] {
  const parts: { label: string; value: string }[] = [];
  for (const f of report.fields) {
    const text = fieldValueText(f.field_value);
    if (text) parts.push({ label: truncate(f.label, 24), value: text });
    if (parts.length === 3) break;
  }
  if (report.items.length > 0) {
    parts.push({
      label: 'Itens',
      value: `${report.items.length} ${report.items.length === 1 ? 'item' : 'itens'}`,
    });
  }
  return parts;
}

function describeRemoteError(err: unknown): string {
  if (err instanceof NetworkError) return err.message;
  if (err instanceof ApiError) return `O servidor respondeu com erro ${err.status}: ${err.message}`;
  return err instanceof Error ? err.message : 'Falha desconhecida ao buscar relatórios do servidor.';
}

// ─── agrupamento por data ────────────────────────────────────────────────

type ReportSection = { title: string; data: Report[] };

const SECTION_ORDER = ['Hoje', 'Ontem', 'Esta semana', 'Este mês', 'Mais antigos'] as const;

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function sectionTitleFor(createdAtIso: string): (typeof SECTION_ORDER)[number] {
  const diffDays = Math.round((startOfDay(new Date()) - startOfDay(new Date(createdAtIso))) / 86_400_000);
  if (diffDays <= 0) return 'Hoje';
  if (diffDays === 1) return 'Ontem';
  if (diffDays < 7) return 'Esta semana';
  if (diffDays < 30) return 'Este mês';
  return 'Mais antigos';
}

function groupByDate(reports: Report[]): ReportSection[] {
  // created_at é sempre um ISO string gerado localmente (Crypto.randomUUID
  // + new Date().toISOString() em Captura.tsx), então dá pra ordenar direto
  // por ele sem se preocupar com a ordem em que ficaram salvos no storage.
  const sorted = [...reports].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  const buckets = new Map<string, Report[]>();
  for (const report of sorted) {
    const title = sectionTitleFor(report.created_at);
    if (!buckets.has(title)) buckets.set(title, []);
    buckets.get(title)!.push(report);
  }
  return SECTION_ORDER.filter((title) => buckets.has(title)).map((title) => ({
    title,
    data: buckets.get(title)!,
  }));
}

/** Data do card: só a hora quando o agrupamento já diz "Hoje"/"Ontem" (não
 * repete o óbvio), data completa nos demais casos. */
function formatCardDate(iso: string, sectionTitle: string): string {
  const d = new Date(iso);
  if (sectionTitle === 'Hoje' || sectionTitle === 'Ontem') {
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function HistoricoScreen() {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);
  // Antes esse erro era engolido em silêncio e a tela só mostrava o que já
  // estava local, sem nenhuma pista do porquê os dados do Supabase não
  // apareciam. Agora fica visível como um aviso no topo da lista.
  const [remoteError, setRemoteError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

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
    setReports(merged);
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

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = {
      all: reports.length, draft: 0, pending_sync: 0, error: 0, synced: 0,
    };
    for (const r of reports) c[r.status]++;
    return c;
  }, [reports]);

  const filteredReports = useMemo(() => {
    const query = normalize(searchQuery.trim());
    return reports.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (!query) return true;
      return reportSearchableText(r).includes(query);
    });
  }, [reports, searchQuery, statusFilter]);

  const sections = useMemo(() => groupByDate(filteredReports), [filteredReports]);
  const hasActiveFilters = searchQuery.trim().length > 0 || statusFilter !== 'all';

  function clearFilters() {
    setSearchQuery('');
    setStatusFilter('all');
  }

  function handleOpenReport(report: Report) {
    navigation.navigate('Revisao', { reportId: report.id });
  }

  async function handleSyncReport(report: Report) {
    setSyncingId(report.id);
    await syncReport(report);
    setSyncingId(null);
    refreshList();
  }

  async function handleExportPdf(report: Report) {
    if (exportingId) return;
    setExportingId(report.id);
    try {
      await openReportPdf(report);
    } catch (err) {
      Alert.alert(
        'Não foi possível gerar o PDF',
        err instanceof Error ? err.message : 'Tente novamente em instantes.',
      );
    } finally {
      setExportingId(null);
    }
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

  const searchAndFilters = (
    <View style={local.toolbar}>
      <View style={local.searchBar}>
        <Ionicons name="search" size={18} color={colors.textMuted} />
        <TextInput
          style={local.searchInput}
          placeholder="Buscar por título, campo, template..."
          placeholderTextColor={colors.textMuted}
          value={searchQuery}
          onChangeText={setSearchQuery}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={local.filterRow}
      >
        {FILTER_OPTIONS.map((opt) => {
          const active = statusFilter === opt.key;
          return (
            <TouchableOpacity
              key={opt.key}
              style={[local.filterChip, active && local.filterChipActive]}
              onPress={() => setStatusFilter(opt.key)}
              activeOpacity={0.8}
            >
              <Text style={[local.filterChipText, active && local.filterChipTextActive]}>
                {opt.label} ({counts[opt.key]})
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );

  const listEmptyComponent = (
    <View style={local.noResults}>
      <Ionicons name="search-outline" size={32} color={colors.textMuted} />
      <Text style={local.emptyTitle}>Nada encontrado</Text>
      <Text style={local.emptyText}>Tente outro termo de busca ou remova os filtros.</Text>
      <TouchableOpacity style={local.clearFiltersButton} onPress={clearFilters} activeOpacity={0.85}>
        <Text style={local.clearFiltersText}>Limpar filtros</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={local.safe}>
      {header}
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={local.list}
        stickySectionHeadersEnabled={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onRefresh={() => refreshList(true)}
        refreshing={refreshing}
        ListHeaderComponent={
          <>
            {searchAndFilters}
            {remoteErrorBanner}
          </>
        }
        ListEmptyComponent={hasActiveFilters ? listEmptyComponent : null}
        renderSectionHeader={({ section }) => (
          <Text style={local.sectionHeader}>{section.title}</Text>
        )}
        renderItem={({ item, section }) => {
          const meta = captureMeta(item);
          const status = STATUS_STYLE[item.status];
          const entries = reportFieldEntries(item);
          return (
            <TouchableOpacity
              style={[local.card, { borderLeftColor: meta.color, borderLeftWidth: 3 }]}
              onPress={() => handleOpenReport(item)}
              activeOpacity={0.9}
            >
              <View style={local.cardHeaderRow}>
                <View style={[local.captureIcon, { backgroundColor: meta.bg }]}>
                  <Ionicons name={meta.icon} size={18} color={meta.color} />
                </View>
                <Text style={local.cardTitle} numberOfLines={1}>
                  {item.context_label || item.form_template_name || 'Informação recebida'}
                </Text>
                <View style={[local.statusPill, { backgroundColor: status.bg }]}>
                  <Ionicons name={status.icon} size={12} color={status.text} />
                  <Text style={[local.statusText, { color: status.text }]}>{STATUS_LABEL[item.status]}</Text>
                </View>
              </View>

              {/*
                Quando a IA já gerou um resumo (ai_summary — ver
                SummaryService.ts), ele é o que vai no card: uma frase só,
                em linguagem natural, em vez de uma lista de campo/valor que
                cresce e fica espremida quando o relatório tem muitos campos
                mas nenhum deles sozinho identifica do que se trata. Sem
                resumo (falhou ao gerar, captura antiga, ou nenhum campo
                ainda preenchido), volta pro comportamento anterior: lista
                até 3 campos, um por linha, ocupando a largura inteira do
                card pra caber o valor completo sem abrir o relatório.
              */}
              {item.ai_summary ? (
                <Text style={local.cardSummaryText} numberOfLines={2}>
                  {item.ai_summary}
                </Text>
              ) : entries.length > 0 ? (
                <View style={local.cardSummaryList}>
                  {entries.map((entry, idx) => (
                    <Text
                      key={`${entry.label}-${idx}`}
                      style={local.cardSummaryRow}
                      numberOfLines={1}
                    >
                      <Text style={local.cardSummaryLabel}>{entry.label}: </Text>
                      <Text style={local.cardSummaryValue}>{entry.value}</Text>
                    </Text>
                  ))}
                </View>
              ) : (
                <Text style={local.cardSummaryEmpty} numberOfLines={2}>
                  Sem informações preenchidas ainda — toque para revisar
                </Text>
              )}

              <View style={local.cardMetaRow}>
                <Ionicons name="time-outline" size={11} color={colors.textMuted} />
                <Text style={local.cardDate}>
                  {formatCardDate(item.created_at, section.title)}
                  {item.captures.length > 1 ? ` · ${item.captures.length} capturas combinadas` : ''}
                  {purposeLabel(item.extraction_purpose) ? ` · ${purposeLabel(item.extraction_purpose)}` : ''}
                </Text>
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
                  style={local.iconAction}
                  onPress={() => void handleExportPdf(item)}
                  activeOpacity={0.7}
                  disabled={exportingId !== null}
                >
                  {exportingId === item.id ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <>
                      <Ionicons name="document-outline" size={16} color={colors.primary} />
                      <Text style={[local.iconActionText, { color: colors.primary }]}>PDF</Text>
                    </>
                  )}
                </TouchableOpacity>

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
  toolbar: { paddingHorizontal: spacing.xxl, marginBottom: spacing.md, gap: spacing.sm },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1.5, borderColor: colors.border,
    paddingHorizontal: spacing.md, height: 44,
  },
  searchInput: { flex: 1, fontSize: 14, color: colors.textPrimary, padding: 0 },
  filterRow: { gap: spacing.sm, paddingRight: spacing.xxl },
  filterChip: {
    backgroundColor: colors.surface, borderRadius: radius.pill,
    borderWidth: 1.5, borderColor: colors.border,
    paddingVertical: 7, paddingHorizontal: 14,
  },
  filterChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterChipText: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  filterChipTextActive: { color: colors.textOnPrimary },
  sectionHeader: {
    fontSize: 12, fontWeight: '800', color: colors.textMuted, letterSpacing: 0.6,
    textTransform: 'uppercase', marginBottom: spacing.sm, marginTop: spacing.xs,
  },
  warningBanner: {
    flexDirection: 'row', backgroundColor: colors.warningSoft, borderRadius: radius.md,
    padding: spacing.md, marginHorizontal: spacing.xxl, marginBottom: spacing.md,
  },
  warningTitle: { fontSize: 12, fontWeight: '700', color: colors.warningStrong },
  warningDetail: { fontSize: 12, color: colors.warningStrong, marginTop: 2 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xxxl },
  noResults: { alignItems: 'center', paddingHorizontal: spacing.xxxl, paddingTop: spacing.xxxl },
  emptyIconWrap: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: colors.primaryLight,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg,
  },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary, marginBottom: 6, textAlign: 'center' },
  emptyText: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  clearFiltersButton: {
    marginTop: spacing.lg, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.primary,
    paddingVertical: 10, paddingHorizontal: 20,
  },
  clearFiltersText: { fontSize: 13, fontWeight: '700', color: colors.primary },
  list: { paddingHorizontal: spacing.xxl, paddingBottom: spacing.xxxl },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md,
    ...shadows.sm,
  },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  captureIcon: {
    width: 32, height: 32, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
  },
  // minWidth: 0 é o que faz o título truncar em vez de empurrar/apertar o
  // selo de status vizinho — sem isso, um Text com flex:1 ainda reserva
  // espaço pelo conteúdo não-truncado em vez do espaço disponível de fato.
  cardTitle: {
    flex: 1, minWidth: 0, fontSize: 16, fontWeight: '800',
    color: colors.textPrimary, letterSpacing: -0.2,
  },
  // A descrição (campos extraídos) é o que mais importa pra identificar um
  // card em meio a outros do mesmo tipo. Antes ela dividia a linha com o
  // ícone e o selo de status e sobrava pouca largura pra texto (só 1-2
  // palavras apareciam); agora ocupa a largura inteira do card, uma linha
  // por campo — como uma mini lista de definição, com o rótulo em negrito
  // ancorando o valor ao que ele representa.
  cardSummaryText: {
    fontSize: 14, lineHeight: 19, marginTop: spacing.sm,
    color: colors.textSecondary, fontWeight: '500',
  },
  cardSummaryList: { marginTop: spacing.sm, gap: 3 },
  cardSummaryRow: { fontSize: 14, lineHeight: 19 },
  cardSummaryLabel: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  cardSummaryValue: { fontSize: 14, fontWeight: '500', color: colors.textSecondary },
  cardSummaryEmpty: {
    fontSize: 14, lineHeight: 19, marginTop: spacing.sm, fontStyle: 'italic', color: colors.textMuted,
  },
  // Linha de metadados (data, nº de capturas, finalidade) — deliberadamente
  // menor e mais apagada que o resumo acima: é contexto de apoio, não o que
  // diferencia um card do outro, então não deve competir por atenção.
  cardMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.sm },
  cardDate: { fontSize: 11, color: colors.textMuted, fontWeight: '500' },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', borderRadius: radius.pill,
    paddingHorizontal: 10, paddingVertical: 5, gap: 4, flexShrink: 0,
  },
  statusText: { fontSize: 11, fontWeight: '700' },
  syncError: { fontSize: 12, color: colors.dangerStrong, marginTop: spacing.sm },
  cardActions: {
    flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.sm, marginTop: spacing.md, paddingTop: spacing.md,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  iconAction: {
    flexDirection: 'row', alignItems: 'center', marginRight: spacing.lg, gap: 5,
  },
  iconActionText: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
});