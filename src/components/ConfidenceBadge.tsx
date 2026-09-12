// src/components/ConfidenceBadge.tsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface Props {
  confidence?: number; // 0-1
}

export function ConfidenceBadge({ confidence }: Props) {
  if (confidence === undefined) return null;
  
  const pct = Math.round(confidence * 100);
  const isHigh = confidence >= 0.8;
  const isMedium = confidence >= 0.5 && confidence < 0.8;
  
  return (
    <View style={[styles.badge, isHigh ? styles.high : isMedium ? styles.medium : styles.low]}>
      <Text style={[styles.text, isHigh ? styles.highText : isMedium ? styles.medText : styles.lowText]}>
        {isHigh ? '✓' : isMedium ? '~' : '!'} {pct}%
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' },
  high: { backgroundColor: '#dcfce7' },
  medium: { backgroundColor: '#fef9c3' },
  low: { backgroundColor: '#fee2e2' },
  text: { fontSize: 11, fontWeight: '700' },
  highText: { color: '#16a34a' },
  medText: { color: '#a16207' },
  lowText: { color: '#dc2626' },
});