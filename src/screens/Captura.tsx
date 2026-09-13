import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useNavigation, useRoute, NavigationProp, RouteProp } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import NetInfo from '@react-native-community/netinfo';
import * as Crypto from 'expo-crypto';
import { RootStackParamList } from '../../App';
import { extractFields } from '../services/api/ai/ExtractionService';
import { useAudioCapture } from '../services/api/speech/AudioRecordingService';
import { StorageService } from '../storage/StorageService';
import { fetchFormTemplateById } from '../services/api/forms/TemplatesService';
import { FormTemplate } from '../types/forms';
import { Capture, ExtractionResult, Report, ReportField } from '../types/reports';
import { emptyFieldValue, parseFieldValue } from '../utils/fieldValue';
import { styles } from '../styles';

function buildReportFields(
  template: FormTemplate,
  extraction: ExtractionResult | null,
): ReportField[] {
  return template.fields.map((field) => {
    const found = extraction?.fields.find((ef) => ef.key === field.key);
    if (found) {
      return {
        form_field_id: field.id,
        key: field.key,
        label: field.label,
        field_value: parseFieldValue(field.type, found.value),
        confidence: found.confidence,
        source: 'ai',
        was_edited: false,
      };
    }
    return {
      form_field_id: field.id,
      key: field.key,
      label: field.label,
      field_value: emptyFieldValue(field.type),
      source: 'manual',
      was_edited: false,
    };
  });
}

export default function CapturaScreen() {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'Captura'>>();
  const { formTemplateId } = route.params;

  const [template, setTemplate] = useState<FormTemplate | null>(null);
  const [loadingTemplate, setLoadingTemplate] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audio = useAudioCapture();

  useEffect(() => {
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

  async function persistAndReview(
    activeTemplate: FormTemplate,
    capture: Capture,
    extraction: ExtractionResult | null,
    extractionFailed: boolean,
  ) {
    const now = new Date().toISOString();
    const report: Report = {
      id: Crypto.randomUUID(),
      form_template_id: activeTemplate.id,
      form_template_name: activeTemplate.name,
      status: 'draft',
      fields: buildReportFields(activeTemplate, extraction),
      captures: [capture],
      created_at: now,
      updated_at: now,
    };

    await StorageService.upsertReport(report);
    navigation.navigate('Revisao', { reportId: report.id, extractionFailed });
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
      const netState = await NetInfo.fetch();
      if (!netState.isConnected) {
        Alert.alert('Sem conexão', 'Você está offline — a extração por IA não está disponível. Preencha manualmente.');
        await persistAndReview(template, capture, null, true);
        return;
      }

      const result = await extractFields(mediaUri, mediaType, template.fields, mimeType);
      if (!result.success) {
        Alert.alert('Extração falhou', `Detalhe: ${result.error ?? 'motivo desconhecido'}`);
      }
      await persistAndReview(template, capture, result, !result.success);
    } catch (err) {
      const message =
        mediaType === 'voice'
          ? 'Falha ao processar gravação. Você pode preencher manualmente.'
          : 'Falha ao processar foto. Você pode preencher manualmente.';
      setError(message);
      Alert.alert('Extração falhou', `${message}\n\nDetalhe: ${err instanceof Error ? err.message : String(err)}`);
      await persistAndReview(template, capture, null, true);
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleToggleRecording() {
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
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#2563eb" />
        <Text style={styles.loadingText}>Carregando formulário...</Text>
      </View>
    );
  }

  if (!template) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>Formulário não encontrado.</Text>
      </View>
    );
  }

  return (
    <View style={styles.containerWithPadding}>
      <View style={styles.header}>
        <Text style={styles.title}>{template.name}</Text>
        <Text style={styles.subtitle}>Grave por voz ou tire uma foto para começar</Text>
      </View>

      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <TouchableOpacity
        style={[styles.button, styles.buttonPrimary]}
        onPress={handleToggleRecording}
        disabled={isProcessing}
        activeOpacity={0.8}
      >
        <Text style={styles.buttonText}>
          {isProcessing
            ? 'Processando...'
            : audio.isRecording
            ? '⏹ Parar gravação'
            : '🎤 Gravar por voz'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.button, styles.buttonPrimary]}
        onPress={handlePhotoCapture}
        disabled={isProcessing || audio.isRecording}
        activeOpacity={0.8}
      >
        <Text style={styles.buttonText}>
          {isProcessing ? 'Processando...' : '📷 Tirar foto'}
        </Text>
      </TouchableOpacity>

      {isProcessing && (
        <View style={styles.loading}>
          <Text style={styles.loadingText}>Processando extração...</Text>
        </View>
      )}
    </View>
  );
}