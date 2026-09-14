// src/services/speech/AudioRecordingService.ts
// expo-av foi removido do Expo Go a partir da SDK 55 (deprecado desde a SDK 54)
// — o substituto oficial, expo-audio, só expõe a gravação via hook do React
// (useAudioRecorder), então esta abstração agora é um hook em vez de funções
// soltas. A interface pública (start/stop) continua simples de usar.
import { useEffect } from 'react';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';

export function useAudioCapture() {
  const recorder = useAudioRecorder(RecordingPresets.LOW_QUALITY);
  const recorderState = useAudioRecorderState(recorder);

  useEffect(() => {
    (async () => {
      const status = await AudioModule.requestRecordingPermissionsAsync();
      if (!status.granted) {
        console.warn('Permissão de microfone negada.');
      }
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
    })();

    // Cleanup: para a gravação se o componente desmontar enquanto estiver ativa.
    // Isso evita leak de recursos e crash quando o usuário navega para fora
    // da tela de Captura sem parar a gravação.
    return () => {
      if (recorder) {
        recorder.stop().catch(() => {
          // Ignora erro no cleanup — o recorder pode já estar parado
        });
      }
    };
  }, [recorder]);

  async function startRecording(): Promise<void> {
    await recorder.prepareToRecordAsync();
    recorder.record();
  }

  async function stopRecording(): Promise<string | null> {
    await recorder.stop();
    return recorder.uri ?? null;
  }

  return {
    isRecording: recorderState.isRecording,
    startRecording,
    stopRecording,
  };
}