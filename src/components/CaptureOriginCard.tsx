// src/components/CaptureOriginCard.tsx
// "De onde veio a extração": mostra a mídia/texto original de cada capture
// do relatório — a permanência da fonte de origem que a Revisão sempre
// prometeu (ver README) mas nunca de fato exibia. Prioriza local_path (o
// arquivo ainda está no dispositivo — funciona offline e imediatamente
// após capturar) e cai para file_url (URL assinada, devolvida pelo backend
// só depois do sync) quando o arquivo local não está mais disponível.

import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  PanResponder,
  PanResponderGestureState,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  useAudioPlayer,
  useAudioPlayerStatus,
} from 'expo-audio';
import { Capture } from '../types/reports';
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

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '0:00';
  }

  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);

  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Altura do "trilho" tocável (maior que a barra visual em si, pra facilitar
// o toque/arraste com o dedo) e diâmetro da "bolinha" que marca a posição
// atual — arrastável para navegar dentro do áudio.
const PROGRESS_TRACK_HEIGHT = 24;
const PROGRESS_BAR_HEIGHT = 4;
const THUMB_SIZE = 14;

/** Barra de progresso do áudio com uma "bolinha" arrastável (scrubber).
 * Não depende de nenhuma lib de slider — usa PanResponder (nativo do RN)
 * pra não adicionar mais uma dependência a um projeto que já evita
 * overengineering. `progress` vai de 0 a 1; `onScrub` é chamado a cada
 * movimento (só atualiza o visual) e `onScrubEnd` quando o dedo solta
 * (aí sim manda a posição final pro player via seekTo). */
function AudioProgressBar({
  progress,
  onScrub,
  onScrubEnd,
  disabled,
}: {
  progress: number;
  onScrub: (fraction: number) => void;
  onScrubEnd: (fraction: number) => void;
  disabled?: boolean;
}) {
  const [trackWidth, setTrackWidth] = useState(0);
  const trackPageX = useRef(0);
  const trackRef = useRef<View>(null);

  function fractionFromGesture(gestureState: PanResponderGestureState): number {
    if (trackWidth <= 0) return 0;
    const x = gestureState.moveX - trackPageX.current;
    return Math.min(1, Math.max(0, x / trackWidth));
  }

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabled,
      onMoveShouldSetPanResponder: () => !disabled,
      onPanResponderGrant: (_evt, gestureState) => {
        onScrub(fractionFromGesture(gestureState));
      },
      onPanResponderMove: (_evt, gestureState) => {
        onScrub(fractionFromGesture(gestureState));
      },
      onPanResponderRelease: (_evt, gestureState) => {
        onScrubEnd(fractionFromGesture(gestureState));
      },
      onPanResponderTerminate: (_evt, gestureState) => {
        onScrubEnd(fractionFromGesture(gestureState));
      },
    }),
  ).current;

  const thumbLeft = Math.min(
    Math.max(progress * trackWidth - THUMB_SIZE / 2, -THUMB_SIZE / 2),
    trackWidth - THUMB_SIZE / 2,
  );

  return (
    <View
      ref={trackRef}
      style={styles.progressTrack}
      hitSlop={{ top: 10, bottom: 10 }}
      onLayout={() => {
        // measure() dá a largura e a posição absoluta na tela (pageX) —
        // necessária pra converter o gestureState.moveX (também absoluto)
        // numa fração 0..1 relativa a esta barra.
        trackRef.current?.measure((_x, _y, width, _height, pageX) => {
          setTrackWidth(width);
          trackPageX.current = pageX;
        });
      }}
      {...panResponder.panHandlers}
    >
      <View style={styles.progressTrackBg} />
      <View
        style={[
          styles.progressTrackFill,
          { width: `${Math.round(progress * 100)}%` },
        ]}
      />
      {trackWidth > 0 && (
        <View
          style={[
            styles.progressThumb,
            { left: thumbLeft },
          ]}
        />
      )}
    </View>
  );
}

function AudioOriginPlayer({
  uri,
  transcript,
}: {
  uri: string;
  transcript?: string | null;
}) {
  const player = useAudioPlayer({ uri });
  const status = useAudioPlayerStatus(player);

  // Enquanto o dedo está arrastando a bolinha, o progresso exibido segue o
  // arraste (não o player, que só é atualizado de verdade ao soltar) — dá
  // uma resposta visual imediata sem stutter de áudio a cada pixel movido.
  const [dragFraction, setDragFraction] = useState<number | null>(null);

  const duration = status.duration || 0;
  const playedFraction = duration > 0 ? status.currentTime / duration : 0;
  const displayedFraction = dragFraction ?? playedFraction;
  const displayedTime = dragFraction != null ? dragFraction * duration : status.currentTime;

  function handleScrubEnd(fraction: number) {
    setDragFraction(null);
    if (duration > 0) {
      player.seekTo(fraction * duration).catch(() => {});
    }
  }

  return (
    <View style={styles.audioBlock}>
      <View style={styles.audioRow}>
        <TouchableOpacity
          style={styles.audioButton}
          activeOpacity={0.85}
          onPress={() =>
            status.playing
              ? player.pause()
              : player.play()
          }
        >
          <Ionicons
            name={
              status.playing
                ? 'pause'
                : 'play'
            }
            size={18}
            color={colors.textOnPrimary}
          />
        </TouchableOpacity>

        <View style={styles.audioInfo}>
          <Text style={styles.originHeaderText}>
            Gravação por voz
          </Text>

          <AudioProgressBar
            progress={displayedFraction}
            onScrub={setDragFraction}
            onScrubEnd={handleScrubEnd}
            disabled={duration <= 0}
          />

          <Text style={styles.audioTime}>
            {formatTime(displayedTime)} /{' '}
            {formatTime(duration)}
          </Text>
        </View>
      </View>

      {!!transcript && (
        <View style={styles.transcriptBlock}>
          <View style={styles.originHeader}>
            <Ionicons
              name="chatbox-ellipses-outline"
              size={13}
              color={colors.textMuted}
            />

            <Text style={styles.originHeaderText}>
              Transcrição
            </Text>
          </View>

          <Text style={styles.textContent}>
            {transcript}
          </Text>

          <Text style={styles.transcriptDisclaimer}>
            Transcrição automática — pode conter erros.
          </Text>
        </View>
      )}
    </View>
  );
}

function PhotoOriginItem({
  uri,
}: {
  uri: string;
}) {
  /*
   * A imagem não recebe mais uma altura fixa.
   *
   * O aspectRatio começa em 4/3 apenas como fallback enquanto a imagem
   * carrega. Assim que o React Native informa as dimensões reais da
   * imagem, usamos width / height para que a caixa mantenha exatamente
   * a mesma proporção da foto original.
   */
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

    return (
      <AudioOriginPlayer uri={uri} transcript={capture.transcript} />
    );
  }

  return null;
}

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

  /*
   * Container separado para a imagem.
   *
   * O fundo ajuda a visualizar fotos que tenham proporções diferentes
   * da tela, sem precisar cortar ou deformar o conteúdo.
   */
  photoContainer: {
    width: '100%',
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surfaceAlt,
  },

  /*
   * A largura ocupa todo o card e a altura é calculada através do
   * aspectRatio da própria fotografia.
   */
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

  audioBlock: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.md,
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
  },

  audioInfo: {
    flex: 1,
  },

  audioTime: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },

  progressTrack: {
    height: PROGRESS_TRACK_HEIGHT,
    justifyContent: 'center',
    marginTop: 6,
  },

  progressTrackBg: {
    height: PROGRESS_BAR_HEIGHT,
    borderRadius: PROGRESS_BAR_HEIGHT / 2,
    backgroundColor: colors.border,
  },

  progressTrackFill: {
    position: 'absolute',
    height: PROGRESS_BAR_HEIGHT,
    borderRadius: PROGRESS_BAR_HEIGHT / 2,
    backgroundColor: colors.primary,
  },

  progressThumb: {
    position: 'absolute',
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: colors.primary,
    top: (PROGRESS_TRACK_HEIGHT - THUMB_SIZE) / 2,
    ...shadows.sm,
  },

  transcriptBlock: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },

  transcriptDisclaimer: {
    fontSize: 11,
    color: colors.textMuted,
    fontStyle: 'italic',
    marginTop: 6,
  },
});