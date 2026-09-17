// src/components/KeyboardAvoidingScreen.tsx
// Envolve o conteúdo de uma tela (ScrollView, FlatList/SectionList ou uma
// View comum) pra que o teclado empurre o conteúdo pra cima em vez de
// simplesmente cobrir o campo que está sendo preenchido.
//
// 'padding' no iOS e 'height' no Android é a combinação padrão recomendada
// pela documentação do React Native — funciona bem tanto com ScrollView
// quanto com FlatList/SectionList (que por baixo dos panos também são
// ScrollView). Não precisa de keyboardVerticalOffset aqui: como o header da
// stack de navegação já fica FORA desta View, a altura disponível que o
// KeyboardAvoidingView enxerga já desconta ele automaticamente.

import { KeyboardAvoidingView, Platform, StyleProp, ViewStyle } from 'react-native';

interface Props {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function KeyboardAvoidingScreen({ children, style }: Props) {
  return (
    <KeyboardAvoidingView
      style={[{ flex: 1 }, style]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {children}
    </KeyboardAvoidingView>
  );
}
