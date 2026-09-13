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
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);

  useEffect(() => {
    (async () => {
      const status = await AudioModule.requestRecordingPermissionsAsync();
      if (!status.granted) {
        console.warn('Permissão de microfone negada.');
      }
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
    })();
  }, []);

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