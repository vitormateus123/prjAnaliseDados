import { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, Alert, ActivityIndicator,
  StyleSheet, Animated, Easing, SafeAreaView, TextInput, ScrollView, Image,
} from 'react-native';
import { useNavigation, useRoute, NavigationProp, RouteProp } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import NetInfo from '@react-native-community/netinfo';
import * as Crypto from 'expo-crypto';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { RootStackParamList } from '../../App';
import { extractFields } from '../services/api/ai/ExtractionService';
import { autoExtractCombined, StagedPhoto } from '../services/api/ai/AutoExtractionService';
import { useAudioCapture } from '../services/api/speech/AudioRecordingService';
import { StorageService } from '../storage/StorageService';
import { fetchFormTemplateById } from '../services/api/forms/TemplatesService';
import { FormTemplate } from '../types/forms';
import { AutoExtractionResult, Capture, Report } from '../types/reports';
import { buildReportFields, buildReportItems, emptyReportItem } from '../utils/reportBuilder';
import { styles as shared } from '../styles';
import { colors, gradients, radius, shadows, spacing } from '../theme';

// A tela funciona em dois modos.
// - Auto (padrão, sem formTemplateId): o usuário anexa foto(s), áudio e/ou
//   texto — em qualquer combinação — e só então envia; a IA decide qual
//   template usar (ou propõe um novo) a partir de TUDO que foi anexado
//   junto. Nada aqui pressupõe que uma modalidade "pertence" a um domínio.
// - Manual (formTemplateId presente, vindo da FormSelectScreen): mantido
//   pra quem prefere escolher o formulário antes — usa o /extract/ clássico,
//   uma mídia por vez, envio imediato (fluxo mais simples, sem combinação).
export default function CapturaScreen() {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'Captura'>>();
  const formTemplateId = route.params?.formTemplateId;
  const isAutoMode = !formTemplateId;

  const [template, setTemplate] = useState<FormTemplate | null>(null);
  const [loadingTemplate, setLoadingTemplate] = useState(!isAutoMode);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [textMode, setTextMode] = useState(false);
  const [textValue, setTextValue] = useState('');
  const audio = useAudioCapture();

  // Anexos da captura atual (modo automático) — o usuário monta isso aos
  // poucos (foto, foto, um áudio, um texto...) e só dispara a extração
  // quando tocar em "Enviar informação".
  const [stagedPhotos, setStagedPhotos] = useState<StagedPhoto[]>([]);
  const [stagedAudio, setStagedAudio] = useState<{ uri: string; mimeType: string } | null>(null);
  const [stagedText, setStagedText] = useState('');

  const hasStaged = stagedPhotos.length > 0 || !!stagedAudio || stagedText.trim().length > 0;

  function clearStaged() {
    setStagedPhotos([]);
    setStagedAudio(null);
    setStagedText('');
  }

  // Pulso suave ao redor do botão de gravação enquanto o áudio está ativo —
  // dá feedback visual claro de "estou ouvindo" sem precisar de libs extras.
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!audio.isRecording) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1100, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [audio.isRecording, pulse]);

  const pulseScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.55] });
  const pulseOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] });

  useEffect(() => {
    if (!formTemplateId) return;
    let active = true;
    setLoadingTemplate(true);
    fetchFormTemplateById(formTemplateId).then((found) => {
      if (active) {
        setTemplate(found);
        setLoadingTemplate(false);
      }
    });
    return () => {
      active = false;
    };
  }, [formTemplateId]);

  async function persistReport(
    resolvedTemplate: FormTemplate,
    captures: Capture[],
    flatFields: ReturnType<typeof buildReportFields>,
    items: ReturnType<typeof buildReportItems>,
    extractionFailed: boolean,
  ) {
    const now = new Date().toISOString();
    const report: Report = {
      id: Crypto.randomUUID(),
      form_template_id: resolvedTemplate.id,
      form_template_name: resolvedTemplate.name,
      status: 'draft',
      fields: flatFields,
      items,
      captures,
      created_at: now,
      updated_at: now,
    };

    await StorageService.upsertReport(report);
    navigation.navigate('Revisao', { reportId: report.id, extractionFailed });
  }

  // ─── modo manual: template já escolhido em FormSelectScreen ────────────
  async function processCaptureManual(
    activeTemplate: FormTemplate,
    capture: Capture,
    mediaUri: string,
    mediaType: 'voice' | 'photo',
    mimeType: string,
  ) {
    const flatTemplateFields = activeTemplate.fields.filter((f) => !f.is_item_field);
    const itemTemplateFields = activeTemplate.fields.filter((f) => f.is_item_field);

    const netState = await NetInfo.fetch();
    if (!netState.isConnected) {
      Alert.alert('Sem conexão', 'Você está offline — a extração por IA não está disponível. Preencha manualmente.');
      const items = activeTemplate.has_items ? [emptyReportItem(itemTemplateFields)] : [];
      await persistReport(activeTemplate, [capture], buildReportFields(flatTemplateFields, null), items, true);
      return;
    }

    try {
      // O endpoint clássico /extract/ não sabe extrair itens repetidos —
      // só os campos de nível de relatório. Quando o template tem
      // has_items=true, o(s) item(ns) ficam pra preencher manualmente.
      const result = await extractFields(mediaUri, mediaType, flatTemplateFields, mimeType);
      if (!result.success) {
        if (__DEV__) console.warn('[Captura] extração falhou:', result.error);
        Alert.alert('Extração falhou', 'Não conseguimos extrair os dados automaticamente. Você pode preencher manualmente.');
      }
      const items = activeTemplate.has_items ? [emptyReportItem(itemTemplateFields)] : [];
      await persistReport(
        activeTemplate, [capture],
        buildReportFields(flatTemplateFields, result.success ? result.fields : null),
        items, !result.success,
      );
    } catch (err) {
      const message =
        mediaType === 'voice'
          ? 'Falha ao processar gravação. Você pode preencher manualmente.'
          : 'Falha ao processar foto. Você pode preencher manualmente.';
      setError(message);
      if (__DEV__) console.warn('[Captura] falha na extração:', err);
      Alert.alert('Extração falhou', message);
      const items = activeTemplate.has_items ? [emptyReportItem(itemTemplateFields)] : [];
      await persistReport(activeTemplate, [capture], buildReportFields(flatTemplateFields, null), items, true);
    }
  }

  async function processCapture(
    mediaUri: string,
    mediaType: 'voice' | 'photo',
    mimeType: string,
  ) {
    if (!template) return;

    setIsProcessing(true);
    setError(null);

    const capture: Capture = {
      id: Crypto.randomUUID(),
      type: mediaType,
      local_path: mediaUri,
      mime_type: mimeType,
      created_at: new Date().toISOString(),
    };

    try {
      await processCaptureManual(template, capture, mediaUri, mediaType, mimeType);
    } finally {
      setIsProcessing(false);
    }
  }

  // ─── modo manual: texto digitado ainda não é suportado (/extract/
  //     clássico não lida com texto) ───────────────────────────────────
  function rejectManualText() {
    Alert.alert(
      'Ainda não disponível',
      'A entrada por texto funciona apenas na captura automática por enquanto. Use foto ou voz para este formulário.',
    );
  }

  // ─── modo automático: usuário anexa foto(s)/áudio/texto e a IA decide ──
  function finishFailureAlert(retry: () => void) {
    Alert.alert(
      'Não foi possível identificar o formulário',
      'Tente de novo, descreva de outro jeito ou escolha o formulário manualmente.',
      [
        { text: 'Escolher manualmente', onPress: () => navigation.navigate('FormSelect') },
        // Mantém o que já foi anexado — só abre a caixa de texto pra
        // complementar/reformular em vez de forçar a lista técnica de
        // formulários.
        { text: 'Descrever de outro jeito', onPress: () => { setTextValue(stagedText); setTextMode(true); } },
        { text: 'Tentar de novo', onPress: retry },
      ],
    );
  }

  async function finishAutoCapture(
    captures: Capture[],
    auto: AutoExtractionResult,
    retry: () => void,
  ) {
    if (!auto.success || !auto.template_id) {
      if (__DEV__) console.warn('[Captura] extração automática falhou:', auto.error);
      finishFailureAlert(retry);
      return;
    }

    const resolvedTemplate = await fetchFormTemplateById(auto.template_id);
    if (!resolvedTemplate) {
      Alert.alert(
        'Erro',
        'O formulário identificado pela IA não pôde ser carregado. Tente de novo.',
      );
      return;
    }

    const flatTemplateFields = resolvedTemplate.fields.filter((f) => !f.is_item_field);
    const itemTemplateFields = resolvedTemplate.fields.filter((f) => f.is_item_field);

    const flatFields = buildReportFields(flatTemplateFields, auto.fields);
    const items = auto.has_items ? buildReportItems(itemTemplateFields, auto.items) : [];

    if (auto.template_is_new) {
      Alert.alert(
        'Novo tipo de formulário identificado',
        `A IA criou o formulário "${resolvedTemplate.name}" para este tipo de conteúdo. Ele já pode ser usado, mas ainda não foi revisado — confira em Ajustes > Revisar formulários.`,
      );
    } else if (auto.new_field_keys && auto.new_field_keys.length > 0) {
      const addedLabels = resolvedTemplate.fields
        .filter((f) => auto.new_field_keys!.includes(f.key))
        .map((f) => f.label)
        .join(', ');
      Alert.alert(
        'Novos campos identificados',
        `A IA percebeu que "${resolvedTemplate.name}" estava sem: ${addedLabels}. Eles foram adicionados ao formulário — remova em Ajustes > Gerenciar formulários se não fizerem sentido.`,
      );
    }

    clearStaged();
    await persistReport(resolvedTemplate, captures, flatFields, items, false);
  }

  async function submitStagedCapture() {
    if (!hasStaged) return;

    const netState = await NetInfo.fetch();
    if (!netState.isConnected) {
      Alert.alert(
        'Sem conexão',
        'A identificação automática do formulário precisa de internet. Escolha um formulário manualmente para continuar offline.',
      );
      navigation.navigate('FormSelect');
      return;
    }

    setIsProcessing(true);
    setError(null);

    const now = new Date().toISOString();
    const captures: Capture[] = [
      ...stagedPhotos.map((p): Capture => ({
        id: Crypto.randomUUID(), type: 'photo', local_path: p.uri, mime_type: p.mimeType, created_at: now,
      })),
      ...(stagedAudio ? [{
        id: Crypto.randomUUID(), type: 'voice' as const, local_path: stagedAudio.uri,
        mime_type: stagedAudio.mimeType, created_at: now,
      }] : []),
      ...(stagedText.trim() ? [{
        id: Crypto.randomUUID(), type: 'text' as const, mime_type: 'text/plain', created_at: now,
      }] : []),
    ];

    try {
      const auto = await autoExtractCombined({
        photos: stagedPhotos,
        audioUri: stagedAudio?.uri,
        audioMimeType: stagedAudio?.mimeType,
        text: stagedText,
      });
      await finishAutoCapture(captures, auto, () => submitStagedCapture());
    } finally {
      setIsProcessing(false);
    }
  }

  function handleTextConfirm() {
    const trimmed = textValue.trim();
    if (!trimmed) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setTextMode(false);
    setTextValue('');
    if (isAutoMode) {
      setStagedText(trimmed);
    } else {
      rejectManualText();
    }
  }

  async function handleToggleRecording() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    if (audio.isRecording) {
      const uri = await audio.stopRecording();
      if (uri) {
        if (isAutoMode) {
          setStagedAudio({ uri, mimeType: 'audio/m4a' });
        } else {
          await processCapture(uri, 'voice', 'audio/m4a');
        }
      }
      return;
    }

    try {
      await audio.startRecording();
    } catch {
      setError('Não foi possível acessar o microfone.');
    }
  }

  async function pickFromCamera() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setError('Permissão de câmera negada.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });

    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    if (isAutoMode) {
      setStagedPhotos((prev) => [
        ...prev,
        { id: Crypto.randomUUID(), uri: asset.uri, mimeType: asset.mimeType ?? 'image/jpeg' },
      ]);
    } else {
      await processCapture(asset.uri, 'photo', asset.mimeType ?? 'image/jpeg');
    }
  }

  async function pickFromLibrary() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Permissão para acessar fotos negada.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      // No modo automático dá pra escolher várias fotos de uma vez — um
      // documento de várias páginas, uma prateleira inteira em ângulos
      // diferentes etc. No modo manual mantém 1 por vez (fluxo mais simples).
      allowsMultipleSelection: isAutoMode,
      selectionLimit: isAutoMode ? 6 : 1,
    });

    if (result.canceled || !result.assets?.length) return;

    if (isAutoMode) {
      setStagedPhotos((prev) => [
        ...prev,
        ...result.assets.map((a) => ({
          id: Crypto.randomUUID(), uri: a.uri, mimeType: a.mimeType ?? 'image/jpeg',
        })),
      ]);
    } else {
      const asset = result.assets[0];
      await processCapture(asset.uri, 'photo', asset.mimeType ?? 'image/jpeg');
    }
  }

  function handlePhotoCapture() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    Alert.alert('Adicionar foto', undefined, [
      { text: 'Tirar foto', onPress: () => { pickFromCamera(); } },
      { text: 'Escolher da galeria', onPress: () => { pickFromLibrary(); } },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  }

  function removeStagedPhoto(id: string) {
    setStagedPhotos((prev) => prev.filter((p) => p.id !== id));
  }

  if (loadingTemplate) {
    return (
      <View style={shared.container}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={shared.loadingText}>Carregando formulário...</Text>
      </View>
    );
  }

  if (!isAutoMode && !template) {
    return (
      <View style={shared.container}>
        <Text style={shared.loadingText}>Formulário não encontrado.</Text>
      </View>
    );
  }

  const recording = audio.isRecording;

  return (
    <SafeAreaView style={local.safe}>
      <View style={local.content}>
        <View style={local.header}>
          <Text style={local.eyebrow}>{isAutoMode ? 'Captura inteligente' : template!.name.toUpperCase()}</Text>
          <Text style={shared.title}>{isAutoMode ? 'Nova captura' : template!.name}</Text>
          <Text style={shared.subtitle}>
            {isAutoMode
              ? 'Junte foto, voz e/ou texto sobre a mesma informação — a IA organiza tudo'
              : 'Grave por voz ou tire uma foto para começar'}
          </Text>
        </View>

        {error && (
          <View style={shared.errorBox}>
            <Text style={shared.errorText}>{error}</Text>
          </View>
        )}

        {isAutoMode && hasStaged && !textMode && (
          <View style={local.stagedSection}>
            <Text style={local.stagedLabel}>Anexado nesta captura</Text>

            {stagedPhotos.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={local.stagedPhotoRow}>
                {stagedPhotos.map((p) => (
                  <View key={p.id} style={local.stagedThumbWrap}>
                    <Image source={{ uri: p.uri }} style={local.stagedThumb} />
                    <TouchableOpacity
                      style={local.stagedRemoveBadge}
                      onPress={() => removeStagedPhoto(p.id)}
                      disabled={isProcessing}
                      hitSlop={8}
                    >
                      <Ionicons name="close" size={12} color={colors.textOnPrimary} />
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            )}

            {stagedAudio && (
              <View style={local.stagedChip}>
                <Ionicons name="mic" size={14} color={colors.primary} />
                <Text style={local.stagedChipText}>Gravação anexada</Text>
                <TouchableOpacity onPress={() => setStagedAudio(null)} disabled={isProcessing} hitSlop={8}>
                  <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
            )}

            {stagedText.trim().length > 0 && (
              <View style={local.stagedChip}>
                <Ionicons name="create-outline" size={14} color={colors.primary} />
                <Text style={local.stagedChipText} numberOfLines={1}>{stagedText}</Text>
                <TouchableOpacity onPress={() => setStagedText('')} disabled={isProcessing} hitSlop={8}>
                  <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
            )}

            <TouchableOpacity
              style={[local.sendButton, isProcessing && local.recordButtonDisabled]}
              onPress={submitStagedCapture}
              disabled={isProcessing}
              activeOpacity={0.88}
            >
              {isProcessing ? (
                <ActivityIndicator size="small" color={colors.textOnPrimary} />
              ) : (
                <>
                  <Ionicons name="send" size={16} color={colors.textOnPrimary} />
                  <Text style={local.sendButtonText}>Enviar informação</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}

        {!textMode && (
          <>
            <View style={local.stage}>
              <Animated.View
                pointerEvents="none"
                style={[
                  local.pulseRing,
                  { transform: [{ scale: pulseScale }], opacity: pulseOpacity },
                ]}
              />
              <TouchableOpacity
                onPress={handleToggleRecording}
                disabled={isProcessing}
                activeOpacity={0.85}
                style={local.recordTouchable}
              >
                <LinearGradient
                  colors={recording ? ['#f87171', '#dc2626'] : gradients.primaryHero}
                  start={{ x: 0.1, y: 0 }}
                  end={{ x: 0.9, y: 1 }}
                  style={[local.recordButton, isProcessing && local.recordButtonDisabled]}
                >
                  {isProcessing ? (
                    <ActivityIndicator size="large" color={colors.textOnPrimary} />
                  ) : (
                    <Ionicons name={recording ? 'stop' : 'mic'} size={44} color={colors.textOnPrimary} />
                  )}
                </LinearGradient>
              </TouchableOpacity>
              <Text style={local.stageLabel}>
                {isProcessing
                  ? 'Processando...'
                  : recording
                  ? 'Toque para parar'
                  : stagedAudio
                  ? 'Toque para regravar'
                  : 'Toque para gravar'}
              </Text>
            </View>

            <TouchableOpacity
              style={local.photoButton}
              onPress={handlePhotoCapture}
              disabled={isProcessing || recording}
              activeOpacity={0.85}
            >
              <View style={local.photoIconWrap}>
                <Ionicons name="camera" size={20} color={colors.primary} />
              </View>
              <Text style={local.photoButtonText}>
                {isProcessing ? 'Processando...' : stagedPhotos.length > 0 ? 'Adicionar mais uma foto' : 'Adicionar foto'}
              </Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[local.photoButton, local.photoButtonSpaced]}
              onPress={() => { setTextValue(stagedText); setTextMode(true); }}
              disabled={isProcessing || recording}
              activeOpacity={0.85}
            >
              <View style={local.photoIconWrap}>
                <Ionicons name="create-outline" size={20} color={colors.primary} />
              </View>
              <Text style={local.photoButtonText}>{stagedText.trim() ? 'Editar texto' : 'Escrever'}</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </>
        )}

        {textMode && (
          <View style={local.textBox}>
            <Text style={local.textBoxLabel}>Digite a informação</Text>
            <TextInput
              style={[shared.input, local.textInput]}
              value={textValue}
              onChangeText={setTextValue}
              placeholder="Ex: contamos 40 caixas de parafusos no galpão 3..."
              placeholderTextColor={colors.textMuted}
              multiline
              autoFocus
              editable={!isProcessing}
            />
            <View style={local.textActions}>
              <TouchableOpacity
                style={local.textCancelButton}
                onPress={() => { setTextMode(false); setTextValue(''); }}
                disabled={isProcessing}
                activeOpacity={0.85}
              >
                <Text style={local.textCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  local.textSendButton,
                  (!textValue.trim() || isProcessing) && local.recordButtonDisabled,
                ]}
                onPress={handleTextConfirm}
                disabled={!textValue.trim() || isProcessing}
                activeOpacity={0.85}
              >
                {isProcessing ? (
                  <ActivityIndicator size="small" color={colors.textOnPrimary} />
                ) : (
                  <Text style={local.textSendText}>{isAutoMode ? 'Adicionar' : 'Enviar'}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {isProcessing && (
          <View style={shared.loading}>
            <Text style={shared.loadingText}>
              {isAutoMode ? 'Identificando formulário e extraindo...' : 'Processando extração...'}
            </Text>
          </View>
        )}

        {isAutoMode && !isProcessing && !textMode && (
          <TouchableOpacity
            onPress={() => navigation.navigate('FormSelect')}
            activeOpacity={0.7}
            style={local.manualLink}
          >
            <Text style={local.manualLinkText}>Prefere escolher o formulário manualmente?</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

const local = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1, padding: spacing.xxl, justifyContent: 'center' },
  header: { marginBottom: spacing.xxl },
  eyebrow: {
    fontSize: 12, fontWeight: '800', color: colors.primary,
    letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 6,
  },
  stage: { alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xxxl },
  recordTouchable: { alignItems: 'center', justifyContent: 'center' },
  pulseRing: {
    position: 'absolute',
    width: 168, height: 168, borderRadius: 84,
    backgroundColor: colors.primary,
  },
  recordButton: {
    width: 168, height: 168, borderRadius: 84,
    alignItems: 'center', justifyContent: 'center',
    ...shadows.lg,
  },
  recordButtonDisabled: { opacity: 0.75 },
  stageLabel: {
    marginTop: spacing.lg,
    fontSize: 14, fontWeight: '700', color: colors.textSecondary,
  },
  photoButton: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1.5, borderColor: colors.border,
    paddingVertical: spacing.lg, paddingHorizontal: spacing.xl,
    ...shadows.sm,
  },
  photoIconWrap: {
    width: 38, height: 38, borderRadius: radius.md,
    backgroundColor: colors.primaryLight,
    alignItems: 'center', justifyContent: 'center',
    marginRight: spacing.md,
  },
  photoButtonText: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  photoButtonSpaced: { marginTop: spacing.md },
  textBox: { marginBottom: spacing.md },
  textBoxLabel: {
    fontSize: 13, fontWeight: '700', color: colors.textSecondary, marginBottom: spacing.sm,
  },
  textInput: { minHeight: 120, textAlignVertical: 'top' },
  textActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  textCancelButton: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.border,
    paddingVertical: spacing.lg,
  },
  textCancelText: { fontSize: 15, fontWeight: '700', color: colors.textSecondary },
  textSendButton: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.lg, backgroundColor: colors.primary,
    paddingVertical: spacing.lg,
  },
  textSendText: { fontSize: 15, fontWeight: '700', color: colors.textOnPrimary },
  manualLink: { marginTop: spacing.xl, alignItems: 'center' },
  manualLinkText: { fontSize: 13, fontWeight: '600', color: colors.primary },
  stagedSection: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, marginBottom: spacing.xl, gap: spacing.sm,
    ...shadows.sm,
  },
  stagedLabel: { fontSize: 12, fontWeight: '800', color: colors.textMuted, letterSpacing: 0.4, marginBottom: 2 },
  stagedPhotoRow: { flexDirection: 'row' },
  stagedThumbWrap: { marginRight: spacing.sm, position: 'relative' },
  stagedThumb: { width: 56, height: 56, borderRadius: radius.md, backgroundColor: colors.border },
  stagedRemoveBadge: {
    position: 'absolute', top: -6, right: -6,
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: colors.dangerStrong,
    alignItems: 'center', justifyContent: 'center',
  },
  stagedChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.primaryLight, borderRadius: radius.pill,
    paddingVertical: 6, paddingHorizontal: 10, alignSelf: 'flex-start', maxWidth: '100%',
  },
  stagedChipText: { fontSize: 12, fontWeight: '600', color: colors.textPrimary, flexShrink: 1 },
  sendButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.primary, borderRadius: radius.lg,
    paddingVertical: spacing.md, marginTop: spacing.xs,
  },
  sendButtonText: { fontSize: 14, fontWeight: '700', color: colors.textOnPrimary },
});