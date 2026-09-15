import { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, Alert, ActivityIndicator,
  StyleSheet, Animated, Easing, SafeAreaView,
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
import { autoExtractFields } from '../services/api/ai/AutoExtractionService';
import { useAudioCapture } from '../services/api/speech/AudioRecordingService';
import { StorageService } from '../storage/StorageService';
import { fetchFormTemplateById } from '../services/api/forms/TemplatesService';
import { FormTemplate } from '../types/forms';
import { Capture, Report } from '../types/reports';
import { buildReportFields, buildReportItems, emptyReportItem } from '../utils/reportBuilder';
import { styles as shared } from '../styles';
import { colors, gradients, radius, shadows, spacing } from '../theme';

// Fase 3: a tela agora funciona em dois modos.
// - Auto (padrão, sem formTemplateId): o app manda só a mídia pra
//   /extract/auto e a IA decide qual template usar (ou propõe um novo).
// - Manual (formTemplateId presente, vindo da FormSelectScreen): mantido
//   pra quem prefere escolher o formulário antes — usa o /extract/ clássico.
export default function CapturaScreen() {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'Captura'>>();
  const formTemplateId = route.params?.formTemplateId;
  const isAutoMode = !formTemplateId;

  const [template, setTemplate] = useState<FormTemplate | null>(null);
  const [loadingTemplate, setLoadingTemplate] = useState(!isAutoMode);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audio = useAudioCapture();

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
    capture: Capture,
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
      captures: [capture],
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
      await persistReport(activeTemplate, capture, buildReportFields(flatTemplateFields, null), items, true);
      return;
    }

    try {
      // O endpoint clássico /extract/ não sabe extrair itens repetidos —
      // só os campos de nível de relatório. Quando o template tem
      // has_items=true, o(s) item(ns) ficam pra preencher manualmente.
      const result = await extractFields(mediaUri, mediaType, flatTemplateFields, mimeType);
      if (!result.success) {
        Alert.alert('Extração falhou', `Detalhe: ${result.error ?? 'motivo desconhecido'}`);
      }
      const items = activeTemplate.has_items ? [emptyReportItem(itemTemplateFields)] : [];
      await persistReport(
        activeTemplate, capture,
        buildReportFields(flatTemplateFields, result.success ? result.fields : null),
        items, !result.success,
      );
    } catch (err) {
      const message =
        mediaType === 'voice'
          ? 'Falha ao processar gravação. Você pode preencher manualmente.'
          : 'Falha ao processar foto. Você pode preencher manualmente.';
      setError(message);
      Alert.alert('Extração falhou', `${message}\n\nDetalhe: ${err instanceof Error ? err.message : String(err)}`);
      const items = activeTemplate.has_items ? [emptyReportItem(itemTemplateFields)] : [];
      await persistReport(activeTemplate, capture, buildReportFields(flatTemplateFields, null), items, true);
    }
  }

  // ─── modo automático: IA decide o template ──────────────────────────────
  async function processCaptureAuto(
    capture: Capture,
    mediaUri: string,
    mediaType: 'voice' | 'photo',
    mimeType: string,
  ) {
    const netState = await NetInfo.fetch();
    if (!netState.isConnected) {
      Alert.alert(
        'Sem conexão',
        'A identificação automática do formulário precisa de internet. Escolha um formulário manualmente para continuar offline.',
      );
      navigation.navigate('FormSelect');
      return;
    }

    const auto = await autoExtractFields(mediaUri, mediaType, mimeType);
    if (!auto.success || !auto.template_id) {
      Alert.alert(
        'Não foi possível identificar o formulário',
        `Detalhe: ${auto.error ?? 'motivo desconhecido'}\n\nVocê pode tentar de novo ou escolher o formulário manualmente.`,
        [
          { text: 'Tentar de novo', style: 'cancel' },
          { text: 'Escolher manualmente', onPress: () => navigation.navigate('FormSelect') },
        ],
      );
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
    }

    await persistReport(resolvedTemplate, capture, flatFields, items, false);
  }

  async function processCapture(
    mediaUri: string,
    mediaType: 'voice' | 'photo',
    mimeType: string,
  ) {
    if (!isAutoMode && !template) return;

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
      if (isAutoMode) {
        await processCaptureAuto(capture, mediaUri, mediaType, mimeType);
      } else if (template) {
        await processCaptureManual(template, capture, mediaUri, mediaType, mimeType);
      }
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleToggleRecording() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    if (audio.isRecording) {
      const uri = await audio.stopRecording();
      if (uri) {
        await processCapture(uri, 'voice', 'audio/m4a');
      }
      return;
    }

    try {
      await audio.startRecording();
    } catch {
      setError('Não foi possível acessar o microfone.');
    }
  }

  async function handlePhotoCapture() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
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
    await processCapture(asset.uri, 'photo', asset.mimeType ?? 'image/jpeg');
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
              ? 'Grave por voz ou tire uma foto — a IA identifica o formulário certo'
              : 'Grave por voz ou tire uma foto para começar'}
          </Text>
        </View>

        {error && (
          <View style={shared.errorBox}>
            <Text style={shared.errorText}>{error}</Text>
          </View>
        )}

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
            {isProcessing ? 'Processando...' : 'Tirar foto'}
          </Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>

        {isProcessing && (
          <View style={shared.loading}>
            <Text style={shared.loadingText}>
              {isAutoMode ? 'Identificando formulário e extraindo...' : 'Processando extração...'}
            </Text>
          </View>
        )}

        {isAutoMode && !isProcessing && (
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
  manualLink: { marginTop: spacing.xl, alignItems: 'center' },
  manualLinkText: { fontSize: 13, fontWeight: '600', color: colors.primary },
});
