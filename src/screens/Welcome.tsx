import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import {
  NavigationProp,
  useNavigation,
} from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import { RootStackParamList } from '../../App';
import {
  colors,
  radius,
  shadows,
  spacing,
} from '../theme';

export default function WelcomeScreen() {
  const navigation =
    useNavigation<
      NavigationProp<RootStackParamList>
    >();

  function handleStart() {
    navigation.navigate('Principal');
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.content}>
          <View style={styles.iconContainer}>
            <Ionicons
              name="sparkles"
              size={34}
              color={colors.primary}
            />
          </View>

          <Text style={styles.title}>
            Bem-vindo!
          </Text>

          <Text style={styles.subtitle}>
            Registre informações por foto, voz ou texto
            e deixe a inteligência artificial organizar
            tudo para você.
          </Text>
        </View>

        <View style={styles.footer}>
          <TouchableOpacity
            style={styles.button}
            activeOpacity={0.85}
            onPress={handleStart}
          >
            <Text style={styles.buttonText}>
              Começar
            </Text>

            <Ionicons
              name="arrow-forward"
              size={18}
              color={colors.textOnPrimary}
            />
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },

  container: {
    flex: 1,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.xxl,
    justifyContent: 'space-between',
  },

  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 80,
  },

  iconContainer: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },

  title: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '800',
    color: colors.textPrimary,
    textAlign: 'center',
  },

  subtitle: {
    maxWidth: 340,
    marginTop: spacing.md,
    fontSize: 15,
    lineHeight: 23,
    color: colors.textSecondary,
    textAlign: 'center',
  },

  footer: {
    width: '100%',
  },

  button: {
    width: '100%',
    minHeight: 54,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    ...shadows.sm,
  },

  buttonText: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.textOnPrimary,
  },
});