// App.tsx
import { useEffect } from 'react';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';

import CapturaScreen from './src/screens/Captura';
import { RevisaoScreen } from './src/screens/RevisaoScreen';
import HistoricoScreen from './src/screens/Historico';
import AjustesScreen from './src/screens/Ajustes';
import { TemplatesRevisaoScreen } from './src/screens/TemplatesRevisao';
import { GerenciarFormulariosScreen } from './src/screens/GerenciarFormularios';
import { startAutoSync } from './src/services/sync/SyncService';
import { colors } from './src/theme';

// Tabs da tela "Principal"
export type MainTabParamList = {
  'Histórico': undefined;
  Ajustes: undefined;
};

// Pilha raiz do app
export type RootStackParamList = {
  Principal: { screen?: keyof MainTabParamList } | undefined;
  // Parâmetro mantido só para compatibilidade com relatórios antigos. A UI
  // principal nunca oferece escolha de formulário.
  Captura: { formTemplateId?: string } | undefined;
  Revisao: { reportId: string; extractionFailed?: boolean };
  TemplatesRevisao: undefined;
  GerenciarFormularios: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.bg,
    primary: colors.primary,
    card: colors.surface,
    border: colors.border,
    text: colors.textPrimary,
  },
};

const screenHeaderOptions = {
  headerStyle: { backgroundColor: colors.surface },
  headerTitleStyle: { fontWeight: '800' as const, color: colors.textPrimary, fontSize: 17 },
  headerTintColor: colors.primary,
  headerShadowVisible: false,
};

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700', marginBottom: 4 },
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: 64,
          paddingTop: 8,
          paddingBottom: 10,
        },
        tabBarIcon: ({ color, focused, size }) => {
          const iconName =
            route.name === 'Histórico'
              ? focused ? 'time' : 'time-outline'
              : focused ? 'settings' : 'settings-outline';
          return <Ionicons name={iconName as any} size={size - 1} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Histórico" component={HistoricoScreen} />
      <Tab.Screen name="Ajustes" component={AjustesScreen} />
    </Tab.Navigator>
  );
}

export default function App() {
  // Liga a sincronização automática em segundo plano uma única vez, pra
  // valer em qualquer tela do app (não só quando o usuário está em
  // Ajustes). Ver SyncService.startAutoSync para os gatilhos.
  useEffect(() => {
    const stopAutoSync = startAutoSync();
    return stopAutoSync;
  }, []);

  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator screenOptions={screenHeaderOptions}>
        <Stack.Screen
          name="Principal"
          component={MainTabs}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="Captura"
          component={CapturaScreen}
          options={{ title: 'Captura' }}
        />
        <Stack.Screen
          name="Revisao"
          component={RevisaoScreen}
          options={{ title: 'Revisão' }}
        />
        <Stack.Screen
          name="TemplatesRevisao"