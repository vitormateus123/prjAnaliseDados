// src/components/CaptureOriginCard.tsx
// "De onde veio a extração": mostra a mídia/texto original de cada capture
// do relatório — a permanência da fonte de origem que a Revisão sempre
// prometeu (ver README) mas nunca de fato exibia. Prioriza local_path (o
// arquivo ainda está no dispositivo — funciona offline e imediatamente
// após capturar) e cai para file_url (URL assinada, devolvida pelo backend
// só depois do sync) quando o arquivo local não está mais disponível.

import React from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Capture } from '../types/reports';
import { colors, radius, shadows, spacing } from '../theme';

function captureSourceUri(capture: Capture): string | undefined {
  return capture.local_path || capture.file_url;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function AudioOriginPlayer({ uri }: { uri: string }) {
  const player = useAudioPlayer({ uri });
  const status = useAudioPlayerStatus(player);

  return (
    <TouchableOpacity
      style={styles.audioRow}
      activeOpacity={0.85}
      onPress={() => (status.playing ? player.pause() : player.play())}
    >
      <View style={styles.audioButton}>
        <Ionicons name={status.playing ? 'pause' : 'play'} size={18} color={colors.textOnPrimary} />
      </View>
      <View style={styles.audioInfo}>
        <Text style={styles.originHeaderText}>Gravação por voz</Text>
        <Text style={styles.audioTime}>
          {formatTime(status.currentTime)} / {formatTime(status.duration)}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

function CaptureOriginItem({ capture }: { capture: Capture }) {
  const uri = captureSourceUri(capture);

  if (capture.type === 'text') {
    if (!capture.text_content) return null;
    return (
      <View style={styles.textBlock}>
        <View style={styles.originHeader}>
          <Ionicons name="create-outline" size={13} color={colors.textMuted} />
          <Text style={styles.originHeaderText}>Texto digitado</Text>
        </View>
        <Text style={styles.textContent}>{capture.text_content}</Text>
      </View>
    );
  }

  if (capture.type === 'photo') {
    if (!uri) return null;
    return (
      <View>
        <View style={styles.originHeader}>
          <Ionicons name="image-outline" size={13} color={colors.textMuted} />
          <Text style={styles.originHeaderText}>Foto</Text>
        </View>
        <Image source={{ uri }} style={styles.photo} resizeMode="cover" />
      </View>
    );
  }

  if (capture.type === 'voice') {
    if (!uri) return null;
    return <AudioOriginPlayer uri={uri} />;
  }

  return null;
}

export function CaptureOriginCard({ captures }: { captures: Capture[] }) {
  const visible = captures.filter((c) => (c.type === 'text' ? !!c.text_content : !!captureSourceUri(c)));
  if (visible.length === 0) return null;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Fonte de origem</Text>
      <Text style={styles.subtitle}>
        {visible.length > 1
          ? 'Conteúdo original que deu origem aos campos extraídos.'
          : 'Conteúdo original que deu origem à extração.'}
      </Text>
      <View style={styles.list}>
        {visible.map((c) => (
          <CaptureOriginItem key={c.id} capture={c} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xl,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.lg,
    ...shadows.sm,
  },
  title: { fontSize: 14, fontWeight: '800', color: colors.textPrimary },
  subtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 2, marginBottom: spacing.md },
  list: { gap: spacing.md },
  originHeader: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 },
  originHeaderText: { fontSize: 11, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  photo: { width: '100%', height: 200, borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
  textBlock: {
    backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.md,
    borderLeftWidth: 3, borderLeftColor: colors.primary,
  },
  textContent: { fontSize: 14, color: colors.textPrimary, lineHeight: 20 },
  audioRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.md,
  },
  audioButton: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  audioInfo: { flex: 1 },
  audioTime: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
});
