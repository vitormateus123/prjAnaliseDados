import { useState } from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { useNavigation, NavigationProp } from '@react-navigation/native';
import { v4 as uuidv4 } from 'uuid';
import { RootStackParamList } from '../../App';
import { extractFieldsFromVoice, extractFieldsFromPhoto } from '../mock/api';
import { upsertReport } from '../storage/reports';
import { Report, ReportField } from '../types';
import { styles } from '../styles';

export default function CapturaScreen() {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleVoiceCapture() {
    setIsProcessing(true);
    setError(null);

    try {
      const result = await extractFieldsFromVoice();
      const fields: ReportField[] = result.fields.map((f) => ({ ...f }));
      const report: Report = {
        id: uuidv4(),
        createdAt: new Date(),
        origin: 'voz',
        fields,
        status: 'pendente',
        isDraft: true,
        syncAttempted: false,
      };
      await upsertReport(report);
      navigation.navigate('Revisao', { reportId: report.id });
    } catch (err) {
      setError('Falha ao processar gravação. Tente novamente.');
    } finally {
      setIsProcessing(false);
    }
  }

  async function handlePhotoCapture() {
    setIsProcessing(true);
    setError(null);

    try {
      const result = await extractFieldsFromPhoto();
      const fields: ReportField[] = result.fields.map((f) => ({ ...f }));
      const report: Report = {
        id: uuidv4(),
        createdAt: new Date(),
        origin: 'foto',
        fields,
        status: 'pendente',
        isDraft: true,
        syncAttempted: false,
      };
      await upsertReport(report);
      navigation.navigate('Revisao', { reportId: report.id });
    } catch (err) {
      setError('Falha ao processar foto. Tente novamente.');
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <View style={styles.containerWithPadding}>
      <View style={styles.header}>
        <Text style={styles.title}>Nova captura</Text>
      </View>

      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <TouchableOpacity
        style={[styles.button, styles.buttonPrimary]}
        onPress={handleVoiceCapture}
        disabled={isProcessing}
        activeOpacity={0.8}
      >
        <Text style={styles.buttonText}>
          {isProcessing ? 'Processando...' : '🎤 Gravar por voz'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.button, styles.buttonPrimary]}
        onPress={handlePhotoCapture}
        disabled={isProcessing}
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