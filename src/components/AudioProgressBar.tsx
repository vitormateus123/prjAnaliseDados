// Barra de progresso interativa de áudio, compartilhada entre o player de
// revisão/histórico (CaptureOriginCard) e a prévia de gravação na tela de
// Captura (antes do envio). Implementada sem @react-native-community/slider
// (que não está instalado e exigiria rebuild nativo) — usa Pressable +
// onLayout para converter a posição do toque na barra em segundos e chamar
// player.seekTo().

import React, { useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { colors } from '../theme';

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '0:00';
  }

  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);

  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function AudioProgressBar({
  currentTime,
  duration,
  onSeek,
}: {
  currentTime: number;
  duration: number;
  onSeek: (seconds: number) => void;
}) {
  const [barWidth, setBarWidth] = useState(0);

  const progress =
    duration > 0 && Number.isFinite(duration)
      ? Math.min(currentTime / duration, 1)
      : 0;

  function handlePress(x: number) {
    if (barWidth <= 0 || duration <= 0 || !Number.isFinite(duration)) return;
    const ratio = Math.max(0, Math.min(x / barWidth, 1));
    onSeek(ratio * duration);
  }

  return (
    <Pressable
      style={styles.progressBar}
      onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
      onPress={(e) => handlePress(e.nativeEvent.locationX)}
    >
      <View style={[styles.progressFill, { flex: progress }]} />
      {progress > 0 && <View style={styles.progressHandle} />}
      <View style={[styles.progressTrack, { flex: Math.max(1 - progress, 0) }]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  progressBar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 20,
    paddingVertical: 7,
  },
  progressFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  progressHandle: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.primary,
    marginHorizontal: -6,
    zIndex: 1,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.border,
  },
});
