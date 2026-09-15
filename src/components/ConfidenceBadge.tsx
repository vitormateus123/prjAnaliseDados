// src/components/ConfidenceBadge.tsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius } from '../theme';

interface Props {
  confidence?: number; // 0-1
}

export function ConfidenceBadge({ confidence }: Props) {
  if (confidence === undefined) return null;

  const pct = Math.round(confidence * 100);
  const isHigh = confidence >= 0.8;
  const isMedium = confidence >= 0.5 && confidence < 0.8;
  const tone = isHigh ? styles.high : isMedium ? styles.medium : styles.low;
  const textTone = isHigh ? styles.highText : isMedium ? styles.medText : styles.lowText;
  const icon = isHigh ? 'checkmark' : isMedium ? 'help' : 'warning';
  const iconColor = isHigh ? colors.success : isMedium ? colors.warning : colors.danger;

  return (
    <View style={[styles.badge, tone]}>
      <Ionicons name={icon} size={11} color={iconColor} />
      <Text style={[styles.text, textTone]}>{pct}%</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start',
  },
  high: { backgroundColor: colors.successSoft },
  medium: { backgroundColor: colors.warningSoft },
  low: { backgroundColor: colors.dangerSoft },
  text: { fontSize: 11, fontWeight: '700' },
  highText: { color: colors.successStrong },
  medText: { color: colors.warningStrong },
  lowText: { color: colors.dangerStrong },
});
