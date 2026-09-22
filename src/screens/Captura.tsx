import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  Alert,
  ActivityIndicator,
  StyleSheet,
  Animated,
  Easing,
  SafeAreaView,
  TextInput,
  ScrollView,
  Image,
  Modal,
} from 'react-native';
import { useNavigation, useRoute, NavigationProp, RouteProp } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import NetInfo from '@react-native-community/netinfo';
import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { RootStackParamList } from '../../App';
import { KeyboardAvoidingScreen } from '../components/KeyboardAvoidingScreen';
import { extractFields } from '../services/api/ai/ExtractionService';
import { autoExtractCombined, StagedPhoto } from '../services/api/ai/AutoExtractionService';
import { checkHealth } from '../services/api/apiClient';
import { useAudioCapture } from '../services/api/speech/AudioRecordingService';
import { StorageService } from '../storage/StorageService';
import { fetchFormTemplateById } from '../services/api/forms/TemplatesService';
import { FormTemplate } from '../types/forms';
import { AutoExtractionResult, Capture, ExtractionPurpose, Report, ReportField, ReportItem } from '../types/reports';
import {
  buildDynamicReportFields,
  buildDynamicReportItems,
  buildReportFields,
  buildReportItems,
  emptyReportItem,
} from '../utils/reportBuilder';
import { PURPOSE_OPTIONS } from '../constants/extractionPurpose';
import { styles as shared } from '../styles';
import { colors, radius, shadows, spacing } from '../theme';

// A entrada principal é sempre livre: foto(s), áudio e texto podem ser
// combinados e a IA decide internamente como estruturar a informação.
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
  const [stagedAudio, setStagedAudio] = useState<{
    uri: string;
    mimeType: string;
  } | null>(null);

  const [stagedText, setStagedText] = useState('');
  const [purpose, setPurpose] = useState<ExtractionPurpose | null>(null);
  const [customInstruction, setCustomInstruction] = useState('');

  // Modal visual para escolher entre câmera e galeria.
  const [photoPickerVisible, setPhotoPickerVisible] = useState(false);

  const hasStaged =
    stagedPhotos.length > 0 ||
    !!stagedAudio ||
    stagedText.trim().length > 0;

  // No modo automático, a captura acontece em duas etapas visuais:
  // 1) adicionar a fonte; 2) definir a finalidade e enviar para análise.
  // A finalidade só aparece depois que existe alguma fonte anexada.
  const captureStep = hasStaged ? 2 : 1;

  // Acorda o backend assim que a tela abre — se o plano gratuito do Render
  // estiver "dormindo", o cold start (30-50s) acontece enquanto a pessoa
  // ainda está tirando a foto/gravando o áudio, em vez de durante a espera
  // depois de tocar em "Enviar". Resultado ignorado de propósito: mesmo se
  // essa chamada falhar/der timeout, ela já cumpriu o papel de acordar o
  // servidor — a extração de verdade tem seu próprio timeout mais folgado.
  useEffect(() => {
    void checkHealth();
  }, []);

  function clearStaged() {
    setStagedPhotos([]);
    setStagedAudio(null);
    setStagedText('');
    setPurpose(null);
    setCustomInstruction('');
  }

  async function persistUnstructuredReport(captures: Capture[]) {
    const now = new Date().toISOString();

    const report: Report = {
      id: Crypto.randomUUID(),
      context_label: 'Informação recebida',
      extraction_purpose: purpose,
      extraction_custom_instruction:
        purpose === 'OTHER'
          ? customInstruction.trim() || null
          : null,
      status: 'draft',
      fields: [],
      items: [],
      captures,
      created_at: now,
      updated_at: now,
    };

    await StorageService.upsertReport(report);

    clearStaged();

    navigation.navigate('Revisao', {
      reportId: report.id,
      extractionFailed: true,
    });
  }

  // Relatório sem template (structure_mode='dynamic') — a IA já devolveu os
  // campos/itens prontos, só falta montar o Report e mandar pra Revisão.
  async function persistDynamicReport(
    captures: Capture[],
    auto: AutoExtractionResult,
    flatFields: ReportField[],
    items: ReportItem[],
  ) {
    const now = new Date().toISOString();

    const report: Report = {
      id: Crypto.randomUUID(),
      context_label:
        auto.context_label ?? 'Informação organizada',
      context_type: auto.context_type ?? null,
      extraction_purpose: purpose,
      extraction_custom_instruction:
        purpose === 'OTHER'
          ? customInstruction.trim() || null
          : null,
      status: 'draft',
      fields: flatFields,
      items,
      captures,
      created_at: now,
      updated_at: now,
    };

    await StorageService.upsertReport(report);

    clearStaged();

    navigation.navigate('Revisao', {
      reportId: report.id,
      extractionFailed: false,
    });
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
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1100,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ]),
    );

    loop.start();

    return () => loop.stop();
  }, [audio.isRecording, pulse]);

  const pulseScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.55],
  });

  const pulseOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.35, 0],
  });

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

      // isAutoMode: veio da tela de finalidade. Modo manual (formTemplateId
      // escolhido em FormSelectScreen) nunca passa por lá — fica null.
      extraction_purpose: isAutoMode ? purpose : null,

      extraction_custom_instruction:
        isAutoMode && purpose === 'OTHER'
          ? customInstruction.trim() || null
          : null,

      status: 'draft',
      fields: flatFields,
      items,
      captures,
      created_at: now,
      updated_at: now,
    };

    await StorageService.upsertReport(report);

    navigation.navigate('Revisao', {
      reportId: report.id,
      extractionFailed,
    });
  }

  // ─── modo manual: template já escolhido em FormSelectScreen ────────────
  async function processCaptureManual(
    activeTemplate: FormTemplate,
    capture: Capture,
    mediaUri: string,
    mediaType: 'voice' | 'photo',
    mimeType: string,
  ) {
    const flatTemplateFields = activeTemplate.fields.filter(
      (f) => !f.is_item_field,
    );

    const itemTemplateFields = activeTemplate.fields.filter(
      (f) => f.is_item_field,
    );

    const netState = await NetInfo.fetch();

    if (!netState.isConnected) {
      Alert.alert(
        'Sem conexão',
        'Você está offline — a extração por IA não está disponível. Preencha manualmente.',
      );

      const items = activeTemplate.has_items
        ? [emptyReportItem(itemTemplateFields)]
        : [];

      await persistReport(
        activeTemplate,
        [capture],
        buildReportFields(flatTemplateFields, null),
        items,
        true,
      );

      return;
    }

    try {
      // O endpoint clássico /extract/ não sabe extrair itens repetidos —
      // só os campos de nível de relatório. Quando o template tem
      // has_items=true, o(s) item(ns) ficam pra preencher manualmente.
      const result = await extractFields(
        mediaUri,
        mediaType,
        flatTemplateFields,
        mimeType,
      );

      if (!result.success) {
        if (__DEV__) {
          console.warn(
            '[Captura] extração falhou:',
            result.error,
          );
        }

        Alert.alert(
          'Extração falhou',
          'Não conseguimos extrair os dados automaticamente. Você pode preencher manualmente.',
        );
      }

      const items = activeTemplate.has_items
        ? [emptyReportItem(itemTemplateFields)]
        : [];

      await persistReport(
        activeTemplate,
        [capture],
        buildReportFields(
          flatTemplateFields,
          result.success
            ? result.fields
            : null,
        ),
        items,
        !result.success,
      );
    } catch (err) {
      const message =
        mediaType === 'voice'
          ? 'Falha ao processar gravação. Você pode preencher manualmente.'
          : 'Falha ao processar foto. Você pode preencher manualmente.';

      setError(message);

      if (__DEV__) {
        console.warn(
          '[Captura] falha na extração:',
          err,
        );
      }

      Alert.alert(
        'Extração falhou',
        message,
      );

      const items = activeTemplate.has_items
        ? [emptyReportItem(itemTemplateFields)]
        : [];

      await persistReport(
        activeTemplate,
        [capture],
        buildReportFields(
          flatTemplateFields,
          null,
        ),
        items,
        true,
      );
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
      await processCaptureManual(
        template,
        capture,
        mediaUri,
        mediaType,
        mimeType,
      );
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
  function finishFailureAlert(
    captures: Capture[],
    retry: () => void,
  ) {
    Alert.alert(
      'Não conseguimos organizar automaticamente',
      'Você pode tentar de novo, complementar a informação ou revisar e preencher os dados manualmente.',
      [
        {
          text: 'Revisar manualmente',
          onPress: () => {
            void persistUnstructuredReport(
              captures,
            );
          },
        },
        {
          text: 'Descrever de outro jeito',
          onPress: () => {
            setTextValue(stagedText);
            setTextMode(true);
          },
        },
        {
          text: 'Tentar de novo',
          onPress: retry,
        },
      ],
    );
  }

  async function finishAutoCapture(
    captures: Capture[],
    auto: AutoExtractionResult,
    retry: () => void,
  ) {
    if (!auto.success) {
      if (__DEV__) {
        console.warn(
          '[Captura] extração automática falhou:',
          auto.error,
        );
      }

      finishFailureAlert(
        captures,
        retry,
      );

      return;
    }

    // ─── sem template: a IA estruturou os campos/itens diretamente ───────
    if (auto.structure_mode === 'dynamic') {
      const flatFields =
        buildDynamicReportFields(
          auto.dynamic_fields ?? [],
        );

      const items =
        buildDynamicReportItems(
          auto.dynamic_items ?? [],
        );

      if (
        flatFields.length === 0 &&
        items.length === 0
      ) {
        finishFailureAlert(
          captures,
          retry,
        );

        return;
      }

      Alert.alert(
        'Informação organizada',
        'Organizamos esta informação sem um formulário fixo. Confira os dados antes de salvar.',
      );

      await persistDynamicReport(
        captures,
        auto,
        flatFields,
        items,
      );

      return;
    }

    // ─── formulário reaproveitado do catálogo ─────────────────────────────
    if (!auto.template_id) {
      finishFailureAlert(
        captures,
        retry,
      );

      return;
    }

    const resolvedTemplate =
      await fetchFormTemplateById(
        auto.template_id,
      );

    if (!resolvedTemplate) {
      Alert.alert(
        'Erro',
        'O formulário identificado pela IA não pôde ser carregado. Tente de novo.',
      );

      return;
    }

    const flatTemplateFields =
      resolvedTemplate.fields.filter(
        (f) => !f.is_item_field,
      );

    const itemTemplateFields =
      resolvedTemplate.fields.filter(
        (f) => f.is_item_field,
      );

    const flatFields =
      buildReportFields(
        flatTemplateFields,
        auto.fields ?? [],
      );

    const items = auto.has_items
      ? buildReportItems(
          itemTemplateFields,
          auto.items ?? [],
        )
      : [];

    if (
      auto.new_field_keys &&
      auto.new_field_keys.length > 0
    ) {
      Alert.alert(
        'Mais informações encontradas',
        'Incluímos informações adicionais para você revisar antes de salvar.',
      );
    }

    clearStaged();

    await persistReport(
      resolvedTemplate,
      captures,
      flatFields,
      items,
      false,
    );
  }

  // 'Outros' só faz sentido com a instrução preenchida — sem ela a IA não
  // tem nenhuma orientação de finalidade (equivale a não ter escolhido nada,
  // mas de forma confusa pro usuário), então bloqueamos o envio aqui.
  const purposeNeedsInstruction =
    purpose === 'OTHER' &&
    !customInstruction.trim();

  async function submitStagedCapture() {
    if (!hasStaged) return;

    if (purposeNeedsInstruction) {
      Alert.alert(
        'Descreva a finalidade',
        'Você escolheu "Outros" — escreva o que você quer identificar ou extrair antes de enviar.',
      );

      return;
    }

    const now =
      new Date().toISOString();

    const captures: Capture[] = [
      ...stagedPhotos.map(
        (p): Capture => ({
          id: Crypto.randomUUID(),
          type: 'photo',
          local_path: p.uri,
          mime_type: p.mimeType,
          created_at: now,
        }),
      ),

      ...(stagedAudio
        ? [
            {
              id: Crypto.randomUUID(),
              type: 'voice' as const,
              local_path:
                stagedAudio.uri,
              mime_type:
                stagedAudio.mimeType,
              created_at: now,
            },
          ]
        : []),

      ...(stagedText.trim()
        ? [
            {
              id: Crypto.randomUUID(),
              type: 'text' as const,
              mime_type:
                'text/plain',
              created_at: now,
              text_content:
                stagedText.trim(),
            },
          ]
        : []),
    ];

    const netState =
      await NetInfo.fetch();

    if (!netState.isConnected) {
      Alert.alert(
        'Sem conexão',
        'Sua informação será salva no dispositivo. Você poderá preenchê-la agora e ela será sincronizada quando houver conexão.',
        [
          {
            text: 'Continuar',
            onPress: () => {
              void persistUnstructuredReport(
                captures,
              );
            },
          },
        ],
      );

      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      const auto =
        await autoExtractCombined({
          photos: stagedPhotos,
          audioUri:
            stagedAudio?.uri,
          audioMimeType:
            stagedAudio?.mimeType,
          text: stagedText,
          purpose,
          customInstruction:
            purpose === 'OTHER'
              ? customInstruction
              : null,
        });

      await finishAutoCapture(
        captures,
        auto,
        () =>
          submitStagedCapture(),
      );
    } finally {
      setIsProcessing(false);
    }
  }

  function handleTextConfirm() {
    const trimmed =
      textValue.trim();

    if (!trimmed) return;

    Haptics.impactAsync(
      Haptics.ImpactFeedbackStyle.Light,
    ).catch(() => {});

    setTextMode(false);
    setTextValue('');

    if (isAutoMode) {
      setStagedText(trimmed);
    } else {
      rejectManualText();
    }
  }

  async function handleToggleRecording() {
    Haptics.impactAsync(
      Haptics.ImpactFeedbackStyle.Medium,
    ).catch(() => {});

    if (audio.isRecording) {
      const uri =
        await audio.stopRecording();

      if (uri) {
        if (isAutoMode) {
          setStagedAudio({
            uri,
            mimeType: 'audio/m4a',
          });
        } else {
          await processCapture(
            uri,
            'voice',
            'audio/m4a',
          );
        }
      }

      return;
    }

    try {
      await audio.startRecording();
    } catch {
      setError(
        'Não foi possível acessar o microfone.',
      );
    }
  }

  async function pickFromCamera() {
    const permission =
      await ImagePicker.requestCameraPermissionsAsync();

    if (!permission.granted) {
      setError(
        'Permissão de câmera negada.',
      );

      return;
    }

    const result =
      await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.7,
      });

    if (
      result.canceled ||
      !result.assets?.[0]
    ) {
      return;
    }

    const asset =
      result.assets[0];

    if (isAutoMode) {
      setStagedPhotos((prev) => [
        ...prev,
        {
          id: Crypto.randomUUID(),
          uri: asset.uri,
          mimeType:
            asset.mimeType ??
            'image/jpeg',
        },
      ]);
    } else {
      await processCapture(
        asset.uri,
        'photo',
        asset.mimeType ??
          'image/jpeg',
      );
    }
  }

  async function pickFromLibrary() {
    const permission =
      await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      setError(
        'Permissão para acessar fotos negada.',
      );

      return;
    }

    const result =
      await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.7,

        // No modo automático dá pra escolher várias fotos de uma vez — um
        // documento de várias páginas, uma prateleira inteira em ângulos
        // diferentes etc. No modo manual mantém 1 por vez (fluxo mais simples).
        allowsMultipleSelection:
          isAutoMode,

        selectionLimit:
          isAutoMode ? 6 : 1,
      });

    if (
      result.canceled ||
      !result.assets?.length
    ) {
      return;
    }

    if (isAutoMode) {
      setStagedPhotos((prev) => [
        ...prev,
        ...result.assets.map((a) => ({
          id: Crypto.randomUUID(),
          uri: a.uri,
          mimeType:
            a.mimeType ??
            'image/jpeg',
        })),
      ]);
    } else {
      const asset =
        result.assets[0];

      await processCapture(
        asset.uri,
        'photo',
        asset.mimeType ??
          'image/jpeg',
      );
    }
  }

  function handlePhotoCapture() {
    Haptics.impactAsync(
      Haptics.ImpactFeedbackStyle.Light,
    ).catch(() => {});

    setPhotoPickerVisible(true);
  }

  function closePhotoPicker() {
    setPhotoPickerVisible(false);
  }

  function openCameraFromPicker() {
    setPhotoPickerVisible(false);

    // O pequeno atraso evita que a animação de fechamento do modal
    // concorra com a abertura da câmera em alguns aparelhos.
    setTimeout(() => {
      void pickFromCamera();
    }, 120);
  }

  function openGalleryFromPicker() {
    setPhotoPickerVisible(false);

    setTimeout(() => {
      void pickFromLibrary();
    }, 120);
  }

  function removeStagedPhoto(id: string) {
    setStagedPhotos((prev) =>
      prev.filter(
        (p) => p.id !== id,
      ),
    );
  }

  if (loadingTemplate) {
    return (
      <View style={shared.container}>
        <ActivityIndicator
          size="large"
          color={colors.primary}
        />

        <Text
          style={
            shared.loadingText
          }
        >
          Carregando formulário...
        </Text>
      </View>
    );
  }

  if (
    !isAutoMode &&
    !template
  ) {
    return (
      <View style={shared.container}>
        <Text
          style={
            shared.loadingText
          }
        >
          Formulário não encontrado.
        </Text>
      </View>
    );
  }

  const recording =
    audio.isRecording;

  return (
    <SafeAreaView
      style={local.safe}
    >
      <KeyboardAvoidingScreen>
        <ScrollView
          style={local.scroll}
          contentContainerStyle={
            local.content
          }
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={local.header}>
            <Text style={local.eyebrow}>
              {isAutoMode
                ? 'Captura inteligente'
                : template!.name.toUpperCase()}
            </Text>

            <Text style={shared.title}>
              {isAutoMode
                ? 'Nova captura'
                : template!.name}
            </Text>

            <Text
              style={shared.subtitle}
            >
              {isAutoMode
                ? captureStep === 1
                  ? 'Adicione uma foto, voz ou texto para começar.'
                  : 'Agora defina a finalidade e envie a informação para análise.'
                : 'Grave por voz ou tire uma foto para começar'}
            </Text>
          </View>

          {error && (
            <View
              style={
                shared.errorBox
              }
            >
              <Text
                style={
                  shared.errorText
                }
              >
                {error}
              </Text>
            </View>
          )}

          {isAutoMode &&
            hasStaged &&
            !textMode && (
              <>
                <View style={local.stepHeader}>
                  <View style={local.stepNumberActive}>
                    <Text style={local.stepNumberTextActive}>1</Text>
                  </View>
                  <View style={local.stepHeaderText}>
                    <Text style={local.stepTitle}>Fonte adicionada</Text>
                    <Text style={local.stepSubtitle}>Confira o conteúdo antes de continuar.</Text>
                  </View>
                  <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                </View>

                <View style={local.stagedSection}>
                  <Text style={local.stagedLabel}>Conteúdo da captura</Text>

                {stagedPhotos.length >
                  0 && (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={
                      false
                    }
                    style={
                      local.stagedPhotoRow
                    }
                  >
                    {stagedPhotos.map(
                      (p) => (
                        <View
                          key={p.id}
                          style={
                            local.stagedThumbWrap
                          }
                        >
                          <Image
                            source={{
                              uri: p.uri,
                            }}
                            style={
                              local.stagedThumb
                            }
                          />

                          <TouchableOpacity
                            style={
                              local.stagedRemoveBadge
                            }
                            onPress={() =>
                              removeStagedPhoto(
                                p.id,
                              )
                            }
                            disabled={
                              isProcessing
                            }
                            hitSlop={8}
                          >
                            <Ionicons
                              name="close"
                              size={12}
                              color={
                                colors.textOnPrimary
                              }
                            />
                          </TouchableOpacity>
                        </View>
                      ),
                    )}
                  </ScrollView>
                )}

                {stagedAudio && (
                  <View
                    style={
                      local.stagedChip
                    }
                  >
                    <Ionicons
                      name="mic"
                      size={14}
                      color={
                        colors.primary
                      }
                    />

                    <Text
                      style={
                        local.stagedChipText
                      }
                    >
                      Gravação anexada
                    </Text>

                    <TouchableOpacity
                      onPress={() =>
                        setStagedAudio(
                          null,
                        )
                      }
                      disabled={
                        isProcessing
                      }
                      hitSlop={8}
                    >
                      <Ionicons
                        name="close-circle"
                        size={16}
                        color={
                          colors.textMuted
                        }
                      />
                    </TouchableOpacity>
                  </View>
                )}

                {stagedText.trim()
                  .length > 0 && (
                  <View
                    style={
                      local.stagedChip
                    }
                  >
                    <Ionicons
                      name="create-outline"
                      size={14}
                      color={
                        colors.primary
                      }
                    />

                    <Text
                      style={
                        local.stagedChipText
                      }
                      numberOfLines={1}
                    >
                      {stagedText}
                    </Text>

                    <TouchableOpacity
                      onPress={() =>
                        setStagedText('')
                      }
                      disabled={
                        isProcessing
                      }
                      hitSlop={8}
                    >
                      <Ionicons
                        name="close-circle"
                        size={16}
                        color={
                          colors.textMuted
                        }
                      />
                    </TouchableOpacity>
                  </View>
                )}

                </View>

                <View style={local.stepHeader}>
                  <View style={local.stepNumberActive}>
                    <Text style={local.stepNumberTextActive}>2</Text>
                  </View>
                  <View style={local.stepHeaderText}>
                    <Text style={local.stepTitle}>Defina a finalidade</Text>
                    <Text style={local.stepSubtitle}>Diga à IA o que você quer obter dessa informação.</Text>
                  </View>
                </View>

                <View style={local.purposeSection}>
                  <Text style={local.purposeLabel}>
                    Qual é a finalidade? (opcional)
                  </Text>

                <View
                  style={
                    local.purposeRow
                  }
                >
                  {PURPOSE_OPTIONS.map(
                    (option) => {
                      const selected =
                        purpose ===
                        option.value;

                      return (
                        <TouchableOpacity
                          key={
                            option.value
                          }
                          style={[
                            local.purposeChip,
                            selected &&
                              local.purposeChipSelected,
                          ]}
                          onPress={() =>
                            setPurpose(
                              selected
                                ? null
                                : option.value,
                            )
                          }
                          disabled={
                            isProcessing
                          }
                          activeOpacity={
                            0.85
                          }
                        >
                          <Ionicons
                            name={
                              option.icon
                            }
                            size={14}
                            color={
                              selected
                                ? colors.textOnPrimary
                                : colors.textSecondary
                            }
                          />

                          <Text
                            style={[
                              local.purposeChipText,
                              selected &&
                                local.purposeChipTextSelected,
                            ]}
                          >
                            {
                              option.label
                            }
                          </Text>
                        </TouchableOpacity>
                      );
                    },
                  )}
                </View>

                {purpose ===
                  'OTHER' && (
                  <TextInput
                    style={[
                      shared.input,
                      local.purposeInstructionInput,
                    ]}
                    value={
                      customInstruction
                    }
                    onChangeText={
                      setCustomInstruction
                    }
                    placeholder="Descreva o que você quer, ex: identificar produtos próximos da validade"
                    placeholderTextColor={
                      colors.textMuted
                    }
                    multiline
                    editable={
                      !isProcessing
                    }
                  />
                )}

                <TouchableOpacity
                  style={[
                    local.sendButton,
                    (isProcessing ||
                      purposeNeedsInstruction) &&
                      local.recordButtonDisabled,
                  ]}
                  onPress={
                    submitStagedCapture
                  }
                  disabled={
                    isProcessing
                  }
                  activeOpacity={
                    0.88
                  }
                >
                  {isProcessing ? (
                    <ActivityIndicator
                      size="small"
                      color={
                        colors.textOnPrimary
                      }
                    />
                  ) : (
                    <>
                      <Ionicons
                        name="send"
                        size={16}
                        color={
                          colors.textOnPrimary
                        }
                      />

                      <Text
                        style={
                          local.sendButtonText
                        }
                      >
                        Enviar informação
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
                </View>
              </>
            )}

          {!textMode && (
            <>
              {isAutoMode && !hasStaged && (
                <View style={local.stepHeader}>
                  <View style={local.stepNumberActive}>
                    <Text style={local.stepNumberTextActive}>1</Text>
                  </View>
                  <View style={local.stepHeaderText}>
                    <Text style={local.stepTitle}>Adicione uma fonte</Text>
                    <Text style={local.stepSubtitle}>Use foto, voz ou texto para começar.</Text>
                  </View>
                </View>
              )}

            <View
              style={
                local.actionsRow
              }
            >
              <TouchableOpacity
                onPress={
                  handleToggleRecording
                }
                disabled={
                  isProcessing
                }
                activeOpacity={0.85}
                style={[
                  local.actionButton,
                  isProcessing &&
                    local.actionButtonDisabled,
                ]}
              >
                <View
                  style={
                    local.actionIconStage
                  }
                >
                  <Animated.View
                    pointerEvents="none"
                    style={[
                      local.pulseRing,
                      {
                        transform: [
                          {
                            scale:
                              pulseScale,
                          },
                        ],
                        opacity:
                          pulseOpacity,
                      },
                    ]}
                  />

                  <View
                    style={[
                      local.actionIconWrap,
                      recording &&
                        local.actionIconWrapActive,
                    ]}
                  >
                    {isProcessing ? (
                      <ActivityIndicator
                        size="small"
                        color={
                          recording
                            ? colors.textOnPrimary
                            : colors.primary
                        }
                      />
                    ) : (
                      <Ionicons
                        name={
                          recording
                            ? 'stop'
                            : 'mic'
                        }
                        size={22}
                        color={
                          recording
                            ? colors.textOnPrimary
                            : colors.primary
                        }
                      />
                    )}
                  </View>
                </View>

                <Text
                  style={
                    local.actionButtonText
                  }
                  numberOfLines={1}
                >
                  {recording
                    ? 'Parar'
                    : stagedAudio
                      ? 'Regravar'
                      : 'Gravar'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  local.actionButton,
                  (isProcessing ||
                    recording) &&
                    local.actionButtonDisabled,
                ]}
                onPress={
                  handlePhotoCapture
                }
                disabled={
                  isProcessing ||
                  recording
                }
                activeOpacity={0.85}
              >
                <View
                  style={
                    local.actionIconStage
                  }
                >
                  <View
                    style={
                      local.actionIconWrap
                    }
                  >
                    <Ionicons
                      name="camera"
                      size={22}
                      color={
                        colors.primary
                      }
                    />
                  </View>
                </View>

                <Text
                  style={
                    local.actionButtonText
                  }
                  numberOfLines={1}
                >
                  {stagedPhotos.length >
                  0
                    ? 'Mais foto'
                    : 'Foto'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  local.actionButton,
                  (isProcessing ||
                    recording) &&
                    local.actionButtonDisabled,
                ]}
                onPress={() => {
                  setTextValue(
                    stagedText,
                  );
                  setTextMode(true);
                }}
                disabled={
                  isProcessing ||
                  recording
                }
                activeOpacity={0.85}
              >
                <View
                  style={
                    local.actionIconStage
                  }
                >
                  <View
                    style={
                      local.actionIconWrap
                    }
                  >
                    <Ionicons
                      name="create-outline"
                      size={22}
                      color={
                        colors.primary
                      }
                    />
                  </View>
                </View>

                <Text
                  style={
                    local.actionButtonText
                  }
                  numberOfLines={1}
                >
                  {stagedText.trim()
                    ? 'Editar texto'
                    : 'Escrever'}
                </Text>
              </TouchableOpacity>
            </View>
            </>
          )}

          {textMode && (
            <View
              style={local.textBox}
            >
              <Text
                style={
                  local.textBoxLabel
                }
              >
                Digite a informação
              </Text>

              <TextInput
                style={[
                  shared.input,
                  local.textInput,
                ]}
                value={textValue}
                onChangeText={
                  setTextValue
                }
                placeholder="Ex: contamos 40 caixas de parafusos no galpão 3..."
                placeholderTextColor={
                  colors.textMuted
                }
                multiline
                autoFocus
                editable={!isProcessing}
              />

              <View
                style={
                  local.textActions
                }
              >
                <TouchableOpacity
                  style={
                    local.textCancelButton
                  }
                  onPress={() => {
                    setTextMode(
                      false,
                    );
                    setTextValue('');
                  }}
                  disabled={
                    isProcessing
                  }
                  activeOpacity={0.85}
                >
                  <Text
                    style={
                      local.textCancelText
                    }
                  >
                    Cancelar
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    local.textSendButton,
                    (!textValue.trim() ||
                      isProcessing) &&
                      local.recordButtonDisabled,
                  ]}
                  onPress={
                    handleTextConfirm
                  }
                  disabled={
                    !textValue.trim() ||
                    isProcessing
                  }
                  activeOpacity={0.85}
                >
                  {isProcessing ? (
                    <ActivityIndicator
                      size="small"
                      color={
                        colors.textOnPrimary
                      }
                    />
                  ) : (
                    <Text
                      style={
                        local.textSendText
                      }
                    >
                      {isAutoMode
                        ? 'Adicionar'
                        : 'Enviar'}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}

          {isProcessing && (
            <View
              style={
                shared.loading
              }
            >
              <Text
                style={
                  shared.loadingText
                }
              >
                {isAutoMode
                  ? 'Identificando formulário e extraindo...'
                  : 'Processando extração...'}
              </Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingScreen>

      {/* Modal de escolha da origem da foto */}
      <Modal
        visible={
          photoPickerVisible
        }
        transparent
        animationType="slide"
        onRequestClose={
          closePhotoPicker
        }
      >
        <View
          style={
            local.photoModalRoot
          }
        >
          <Pressable
            style={
              local.photoModalBackdrop
            }
            onPress={
              closePhotoPicker
            }
          />

          <View
            style={
              local.photoSheet
            }
          >
            <View
              style={
                local.photoSheetHandle
              }
            />

            <View
              style={
                local.photoSheetHeader
              }
            >
              <View
                style={
                  local.photoSheetIcon
                }
              >
                <Ionicons
                  name="image-outline"
                  size={22}
                  color={
                    colors.primary
                  }
                />
              </View>

              <View
                style={
                  local.photoSheetHeaderText
                }
              >
                <Text
                  style={
                    local.photoSheetTitle
                  }
                >
                  Adicionar foto
                </Text>

                <Text
                  style={
                    local.photoSheetSubtitle
                  }
                >
                  Como você quer adicionar uma foto?
                </Text>
              </View>
            </View>

            <View
              style={
                local.photoOptions
              }
            >
              <TouchableOpacity
                style={
                  local.photoOption
                }
                activeOpacity={0.82}
                onPress={
                  openCameraFromPicker
                }
              >
                <View
                  style={
                    local.photoOptionIcon
                  }
                >
                  <Ionicons
                    name="camera"
                    size={22}
                    color={
                      colors.primary
                    }
                  />
                </View>

                <View
                  style={
                    local.photoOptionContent
                  }
                >
                  <Text
                    style={
                      local.photoOptionTitle
                    }
                  >
                    Tirar foto
                  </Text>

                  <Text
                    style={
                      local.photoOptionDescription
                    }
                  >
                    Usar a câmera do aparelho
                  </Text>
                </View>

                <Ionicons
                  name="chevron-forward"
                  size={19}
                  color={
                    colors.textMuted
                  }
                />
              </TouchableOpacity>

              <TouchableOpacity
                style={
                  local.photoOption
                }
                activeOpacity={0.82}
                onPress={
                  openGalleryFromPicker
                }
              >
                <View
                  style={
                    local.photoOptionIcon
                  }
                >
                  <Ionicons
                    name="images"
                    size={22}
                    color={
                      colors.primary
                    }
                  />
                </View>

                <View
                  style={
                    local.photoOptionContent
                  }
                >
                  <Text
                    style={
                      local.photoOptionTitle
                    }
                  >
                    Escolher da galeria
                  </Text>

                  <Text
                    style={
                      local.photoOptionDescription
                    }
                  >
                    {isAutoMode
                      ? 'Selecionar uma ou várias fotos'
                      : 'Selecionar uma foto salva'}
                  </Text>
                </View>

                <Ionicons
                  name="chevron-forward"
                  size={19}
                  color={
                    colors.textMuted
                  }
                />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={
                local.photoCancelButton
              }
              activeOpacity={0.8}
              onPress={
                closePhotoPicker
              }
            >
              <Text
                style={
                  local.photoCancelText
                }
              >
                Cancelar
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const local = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },

  scroll: {
    flex: 1,
  },

  content: {
    flexGrow: 1,
    padding: spacing.xxl,
    justifyContent: 'center',
  },

  header: {
    marginBottom: spacing.xxl,
  },

  eyebrow: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 6,
  },

  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },

  stepNumberActive: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  stepNumberTextActive: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.textOnPrimary,
  },

  stepHeaderText: {
    flex: 1,
  },

  stepTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.textPrimary,
  },

  stepSubtitle: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.textSecondary,
    marginTop: 2,
  },

  purposeSection: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.xl,
    ...shadows.sm,
  },

  actionsRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.xxxl,
  },

  actionButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xs,
    minHeight: 104,
    ...shadows.sm,
  },

  actionButtonDisabled: {
    opacity: 0.55,
  },

  actionIconStage: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },

  pulseRing: {
    position: 'absolute',
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor:
      colors.dangerStrong,
  },

  actionIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor:
      colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },

  actionIconWrapActive: {
    backgroundColor:
      colors.dangerStrong,
  },

  actionButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
  },

  recordButtonDisabled: {
    opacity: 0.75,
  },

  textBox: {
    marginBottom: spacing.md,
  },

  textBoxLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },

  textInput: {
    minHeight: 120,
    textAlignVertical: 'top',
  },

  textActions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.md,
  },

  textCancelButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingVertical: spacing.lg,
  },

  textCancelText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textSecondary,
  },

  textSendButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    backgroundColor:
      colors.primary,
    paddingVertical: spacing.lg,
  },

  textSendText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textOnPrimary,
  },

  manualLink: {
    marginTop: spacing.xl,
    alignItems: 'center',
  },

  manualLinkText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },

  stagedSection: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.xl,
    gap: spacing.sm,
    ...shadows.sm,
  },

  stagedLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.textMuted,
    letterSpacing: 0.4,
    marginBottom: 2,
  },

  stagedPhotoRow: {
    flexDirection: 'row',
  },

  stagedThumbWrap: {
    marginRight: spacing.sm,
    position: 'relative',
  },

  stagedThumb: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.border,
  },

  stagedRemoveBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor:
      colors.dangerStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },

  stagedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor:
      colors.primaryLight,
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: 10,
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },

  stagedChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textPrimary,
    flexShrink: 1,
  },

  purposeLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },

  purposeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: spacing.sm,
  },

  purposeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },

  purposeChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },

  purposeChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },

  purposeChipTextSelected: {
    color: colors.textOnPrimary,
  },

  purposeInstructionInput: {
    minHeight: 64,
    textAlignVertical: 'top',
    marginBottom: spacing.sm,
  },

  sendButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    marginTop: spacing.xs,
  },

  sendButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textOnPrimary,
  },

  // ─── Modal de adicionar foto ──────────────────────────────────────────

  photoModalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },

  photoModalBackdrop: {
  ...StyleSheet.absoluteFill,
  backgroundColor: 'rgba(0, 0, 0, 0.42)',
  },

  photoSheet: {
  backgroundColor: colors.surface,
  borderTopLeftRadius: 28,
  borderTopRightRadius: 28,
  paddingHorizontal: spacing.xl,
  paddingTop: spacing.sm,
  paddingBottom: spacing.xl,

  shadowColor: '#000',
  shadowOffset: {
    width: 0,
    height: -4,
  },
  shadowOpacity: 0.08,
  shadowRadius: 14,
  elevation: 12,
},

  photoSheetHandle: {
  width: 38,
  height: 4,
  borderRadius: 2,
  backgroundColor: colors.border,
  alignSelf: 'center',
  marginBottom: spacing.xl,
  opacity: 0.7,
},

  photoSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.xl,
  },

  photoSheetIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor:
      colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },

  photoSheetHeaderText: {
    flex: 1,
  },

  photoSheetTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.textPrimary,
  },

  photoSheetSubtitle: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
    marginTop: 3,
  },

  photoOptions: {
    gap: spacing.sm,
  },

  photoOption: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 76,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },

  photoOptionIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor:
      colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },

  photoOptionContent: {
    flex: 1,
  },

  photoOptionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.textPrimary,
  },

  photoOptionDescription: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 3,
  },

  photoCancelButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    marginTop: spacing.md,
    borderRadius: radius.lg,
    backgroundColor:
      colors.surfaceAlt,
  },

  photoCancelText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textSecondary,
  },
});