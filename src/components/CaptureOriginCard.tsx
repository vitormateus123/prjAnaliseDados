// "De onde veio a extração": mostra a mídia/texto original de cada capture
// do relatório — a permanência da fonte de origem que a Revisão sempre
// prometeu (ver README) mas nunca de fato exibia. Prioriza local_path (o
// arquivo ainda está no dispositivo — funciona offline e imediatamente
// após capturar) e cai para file_url (URL assinada, devolvida pelo backend
// só depois do sync) quando o arquivo local não está mais disponível.

import React, { useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  useAudioPlayer,
  useAudioPlayerStatus,
} from 'expo-audio';
import { Capture } from '../types/reports';
import { formatTime, AudioProgressBar } from './AudioProgressBar';
import {
  colors,
  radius,
  shadows,
  spacing,
} from '../theme';

function captureSourceUri(
  capture: Capture,
): string | undefined {
  return capture.local_path || capture.file_url;
}

// ─── Player de áudio ─────────────────────────────────────────────────────────

function AudioOriginPlayer({
  uri,
  transcript,
}: {
  uri: string;
  transcript?: string;
}) {
  const player = useAudioPlayer({ uri });
  const status = useAudioPlayerStatus(player);

  const isPlaying = status.playing;
  const currentTime = status.currentTime ?? 0;
  const duration = status.duration ?? 0;

  function handleSeek(seconds: number) {
    player.seekTo(seconds);
  }

  return (
    <View style={styles.audioCard}>
      {/* cabeçalho com label */}
      <View style={styles.originHeader}>
        <Ionicons
          name="mic"
          size={13}
          color={colors.textMuted}
        />
        <Text style={styles.originHeaderText}>
          Gravação por voz
        </Text>
      </View>

      {/* controles do player */}
      <View style={styles.audioRow}>
        <TouchableOpacity
          style={styles.audioButton}
          activeOpacity={0.85}
          onPress={() => (isPlaying ? player.pause() : player.play())}
        >
          <Ionicons
            name={isPlaying ? 'pause' : 'play'}
            size={18}
            color={colors.textOnPrimary}
          />
        </TouchableOpacity>

        <View style={styles.audioBody}>
          {/* barra de progresso interativa */}
          <AudioProgressBar
            currentTime={currentTime}
            duration={duration}
            onSeek={handleSeek}
          />

          {/* tempo atual / duração total */}
          <View style={styles.audioTimeRow}>
            <Text style={styles.audioTime}>
              {formatTime(currentTime)}
            </Text>
            <Text style={styles.audioTime}>
              {formatTime(duration)}
            </Text>
          </View>
        </View>
      </View>

      {/* transcrição do áudio (quando disponível) */}
      {!!transcript && (
        <View style={styles.transcriptBox}>
          <View style={styles.transcriptHeader}>
            <Ionicons
              name="document-text-outline"
              size={12}
              color={colors.textMuted}
            />
            <Text style={styles.transcriptLabel}>
              Transcrição do áudio
            </Text>
          </View>
          <Text style={styles.transcriptText}>
            {transcript}
          </Text>
        </View>
      )}
    </View>
  );
}

// ─── Item de foto ─────────────────────────────────────────────────────────────

function PhotoOriginItem({
  uri,
}: {
  uri: string;
}) {
  const [aspectRatio, setAspectRatio] =
    useState(4 / 3);

  return (
    <View>
      <View style={styles.originHeader}>
        <Ionicons
          name="image-outline"
          size={13}
          color={colors.textMuted}
        />

        <Text style={styles.originHeaderText}>
          Foto
        </Text>
      </View>

      <View style={styles.photoContainer}>
        <Image
          source={{ uri }}
          style={[
            styles.photo,
            { aspectRatio },
          ]}
          resizeMode="contain"
          onLoad={(event) => {
            const {
              width,
              height,
            } = event.nativeEvent.source;

            if (
              width > 0 &&
              height > 0
            ) {
              setAspectRatio(
                width / height,
              );
            }
          }}
        />
      </View>
    </View>
  );
}

// ─── Item genérico de captura ─────────────────────────────────────────────────

function CaptureOriginItem({
  capture,
}: {
  capture: Capture;
}) {
  const uri = captureSourceUri(capture);

  if (capture.type === 'text') {
    if (!capture.text_content) {
      return null;
    }

    return (
      <View style={styles.textBlock}>
        <View style={styles.originHeader}>
          <Ionicons
            name="create-outline"
            size={13}
            color={colors.textMuted}
          />

          <Text style={styles.originHeaderText}>
            Texto digitado
          </Text>
        </View>

        <Text style={styles.textContent}>
          {capture.text_content}
        </Text>
      </View>
    );
  }

  if (capture.type === 'photo') {
    if (!uri) {
      return null;
    }

    return <PhotoOriginItem uri={uri} />;
  }

  if (capture.type === 'voice') {
    if (!uri) {
      return null;
    }

    // `transcript` é o campo usado logo após a captura (antes de qualquer
    // sync); `text_content` é o que efetivamente sobrevive ao POST
    // /reports/ e volta do backend ao reabrir o relatório depois de
    // sincronizado — ver Captura.tsx (capturesWithTranscript).
    return (
      <AudioOriginPlayer
        uri={uri}
        transcript={capture.transcript ?? capture.text_content}
      />
    );
  }

  return null;
}

// ─── Card principal ───────────────────────────────────────────────────────────

export function CaptureOriginCard({
  captures,
}: {
  captures: Capture[];
}) {
  const visible = captures.filter((c) =>
    c.type === 'text'
      ? !!c.text_content
      : !!captureSourceUri(c),
  );

  if (visible.length === 0) {
    return null;
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>
        Fonte de origem
      </Text>

      <Text style={styles.subtitle}>
        {visible.length > 1
          ? 'Conteúdo original que deu origem aos campos extraídos.'
          : 'Conteúdo original que deu origem à extração.'}
      </Text>

      <View style={styles.list}>
        {visible.map((c) => (
          <CaptureOriginItem
            key={c.id}
            capture={c}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
    ...shadows.sm,
  },

  title: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.textPrimary,
  },

  subtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
    marginBottom: spacing.md,
  },

  list: {
    gap: spacing.md,
  },

  originHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 6,
  },

  originHeaderText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },

  photoContainer: {
    width: '100%',
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surfaceAlt,
  },

  photo: {
    width: '100%',
    backgroundColor: colors.surfaceAlt,
  },

  textBlock: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },

  textContent: {
    fontSize: 14,
    color: colors.textPrimary,
    lineHeight: 20,
  },

  // ─── Player de áudio ──────────────────────────────────────────────────

  audioCard: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },

  audioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },

  audioButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },

  audioBody: {
    flex: 1,
    gap: 4,
  },

  audioTimeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },

  audioTime: {
    fontSize: 11,
    color: colors.textSecondary,
  },

  // ─── Transcrição ──────────────────────────────────────────────────────

  transcriptBox: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    padding: spacing.sm,
    borderLeftWidth: 2,
    borderLeftColor: colors.primary,
    marginTop: spacing.xs,
  },

  transcriptHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
  },

  transcriptLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },

  transcriptText: {
    fontSize: 13,
    color: colors.textPrimary,
    lineHeight: 19,
  },
});