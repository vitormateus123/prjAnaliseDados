// src/services/speech/AudioRecordingService.ts
import { Audio } from 'expo-av';

let _recording: Audio.Recording | null = null;

export async function startRecording(): Promise<void> {
  await Audio.requestPermissionsAsync();
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
  });
  
  const { recording } = await Audio.Recording.createAsync(
    Audio.RecordingOptionsPresets.HIGH_QUALITY,
  );
  _recording = recording;
}

export async function stopRecording(): Promise<string | null> {
  if (!_recording) return null;
  await _recording.stopAndUnloadAsync();
  const uri = _recording.getURI();
  _recording = null;
  
  await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
  return uri ?? null;
}

export function isRecording(): boolean {
  return _recording !== null;
}