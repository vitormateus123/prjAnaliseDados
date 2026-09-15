// src/styles.ts
// Estilos compartilhados entre telas. Construído sobre os tokens de
// src/theme.ts — mudanças de identidade visual devem começar lá.
import { StyleSheet } from 'react-native';
import { colors, radius, shadows, spacing, typography } from './theme';

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  containerWithPadding: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: spacing.xxl,
  },
  scroll: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: spacing.xxl,
  },
  header: {
    width: '100%',
    marginBottom: spacing.xxl,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  title: {
    ...typography.display,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    lineHeight: 20,
  },
  button: {
    height: 58,
    borderRadius: radius.lg,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    marginBottom: spacing.md,
    ...shadows.sm,
  },
  buttonPrimary: {
    backgroundColor: colors.primary,
  },
  buttonSecondary: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    shadowOpacity: 0,
    elevation: 0,
  },
  buttonText: {
    ...typography.button,
    color: colors.textOnPrimary,
  },
  buttonTextSecondary: {
    ...typography.button,
    color: colors.textPrimary,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.sm,
  },
  field: {
    marginBottom: spacing.xl,
  },
  label: {
    ...typography.bodySmall,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  input: {
    minHeight: 54,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: 16,
    color: colors.textPrimary,
  },
  errorBox: {
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.xl,
    borderLeftWidth: 3,
    borderLeftColor: colors.danger,
  },
  errorText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.dangerStrong,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxxl,
  },
  emptyTitle: {
    ...typography.h1,
    color: colors.textPrimary,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  emptyText: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.xxl,
    textAlign: 'center',
    lineHeight: 21,
  },
  loading: {
    marginTop: spacing.xxl,
    alignItems: 'center',
  },
  loadingText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  statusBadge: {
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
    fontSize: 12,
    fontWeight: '700',
  },
  statusPendente: {
    backgroundColor: colors.warningSoft,
    color: colors.warningStrong,
  },
  statusSincronizado: {
    backgroundColor: colors.successSoft,
    color: colors.successStrong,
  },
  actionsRow: {
    flexDirection: 'row',
    marginTop: spacing.xl,
    marginBottom: spacing.xxl,
    gap: spacing.sm,
  },
  actionButton: {
    flex: 1,
    height: 50,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  actionButtonLast: {
    marginRight: 0,
  },
  actionPrimary: {
    backgroundColor: colors.primary,
  },
  actionSecondary: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textOnPrimary,
  },
  actionTextSecondary: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  sectionTitle: {
    ...typography.h2,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  sectionText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  statsNumber: {
    fontSize: 40,
    fontWeight: '800',
    color: colors.primary,
    textAlign: 'center',
    marginBottom: spacing.md,
    letterSpacing: -1,
  },
  onlineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: spacing.sm,
  },
  onlineDotOn: {
    backgroundColor: colors.success,
  },
  onlineDotOff: {
    backgroundColor: colors.danger,
  },
});
