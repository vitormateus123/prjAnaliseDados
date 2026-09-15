// src/theme.ts
// Design system central do app — cores, tipografia, espaçamento e sombras.
// Todas as telas devem consumir estes tokens em vez de valores soltos,
// pra manter consistência visual e facilitar futuras mudanças de identidade.

import { Platform } from 'react-native';

export const colors = {
  // Fundo
  bg: '#f4f5fb',
  bgAlt: '#eceefb',
  surface: '#ffffff',
  surfaceAlt: '#f8f9fd',
  border: '#e6e8f4',
  borderStrong: '#d7daf0',

  // Marca — indigo/violeta, mais sofisticado que o azul genérico anterior
  primary: '#4f46e5',
  primaryDark: '#3730a3',
  primaryLight: '#eef0ff',
  primarySoft: '#e0e2fc',
  accent: '#7c3aed',
  accentSoft: '#f3e8ff',

  // Texto
  textPrimary: '#161827',
  textSecondary: '#5c6079',
  textMuted: '#9599b3',
  textOnPrimary: '#ffffff',
  textOnPrimarySoft: 'rgba(255,255,255,0.78)',

  // Semântico
  success: '#0f9d58',
  successSoft: '#dcfce7',
  successStrong: '#065f46',
  warning: '#d97706',
  warningSoft: '#fef3c7',
  warningStrong: '#92400e',
  danger: '#dc2626',
  dangerSoft: '#fee2e2',
  dangerStrong: '#991b1b',
  info: '#0284c7',
  infoSoft: '#e0f2fe',
  infoStrong: '#075985',

  overlay: 'rgba(22, 24, 39, 0.5)',
};

export const gradients = {
  primary: ['#6366f1', '#4338ca'] as const,
  primaryHero: ['#4f46e5', '#3730a3'] as const,
  accent: ['#8b5cf6', '#5b21b6'] as const,
  success: ['#22c55e', '#0f9d58'] as const,
  subtle: ['#f4f5fb', '#e9ebfa'] as const,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

export const radius = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  pill: 999,
};

export const typography = {
  display: { fontSize: 28, fontWeight: '800' as const, letterSpacing: -0.4 },
  h1: { fontSize: 22, fontWeight: '800' as const, letterSpacing: -0.3 },
  h2: { fontSize: 17, fontWeight: '700' as const },
  body: { fontSize: 15, fontWeight: '500' as const },
  bodySmall: { fontSize: 13, fontWeight: '500' as const },
  caption: { fontSize: 12, fontWeight: '600' as const },
  button: { fontSize: 15, fontWeight: '700' as const, letterSpacing: 0.2 },
};

// Sombras suaves e coerentes — a cor da sombra puxa levemente pro tom da
// marca em vez do preto puro, o que dá um acabamento mais "premium".
function shadow(elevation: number, opacity: number, radiusVal: number, offsetY: number) {
  return Platform.select({
    ios: {
      shadowColor: '#312e81',
      shadowOffset: { width: 0, height: offsetY },
      shadowOpacity: opacity,
      shadowRadius: radiusVal,
    },
    android: { elevation },
    default: {
      shadowColor: '#312e81',
      shadowOffset: { width: 0, height: offsetY },
      shadowOpacity: opacity,
      shadowRadius: radiusVal,
      elevation,
    },
  });
}

export const shadows = {
  sm: shadow(2, 0.06, 6, 2),
  md: shadow(5, 0.09, 14, 6),
  lg: shadow(10, 0.14, 24, 12),
};

export const theme = { colors, gradients, spacing, radius, typography, shadows };
export default theme;
