import { useEffect, useState } from 'react';
import {
  NavigationContainer,
  DefaultTheme,
} from '@react-navigation/native';
import {
  createNativeStackNavigator,
} from '@react-navigation/native-stack';
import {
  createBottomTabNavigator,
} from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { Session } from '@supabase/supabase-js';

import LoginScreen from './src/screens/Login';
import CapturaScreen from './src/screens/Captura';
import { RevisaoScreen } from './src/screens/RevisaoScreen';
import HistoricoScreen from './src/screens/Historico';
import AjustesScreen from './src/screens/Ajustes';
import { TemplatesRevisaoScreen } from './src/screens/TemplatesRevisao';
import { GerenciarFormulariosScreen } from './src/screens/GerenciarFormularios';
import { startAutoSync } from './src/services/sync/SyncService';
import { supabase } from './src/services/auth/supabaseClient';
import { warmUpBackend } from './src/services/api/apiClient';
import { colors } from './src/theme';

export type MainTabParamList = {
  'Histórico': undefined;
  Ajustes: undefined;
};

export type RootStackParamList = {
  Login: undefined;
  Principal:
    | {
        screen?: keyof MainTabParamList;
      }
    | undefined;
  Captura:
    | {
        formTemplateId?: string;
      }
    | undefined;
  Revisao: {
    reportId: string;
    extractionFailed?: boolean;
  };
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
  headerStyle: {
    backgroundColor: colors.surface,
  },
  headerTitleStyle: {
    fontWeight: '800' as const,
    color: colors.textPrimary,
    fontSize: 17,
  },
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
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '700',
          marginBottom: 4,
        },
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
          return (
            <Ionicons
              name={iconName as any}
              size={size - 1}
              color={color}
            />
          );
        },
      })}
    >
      <Tab.Screen name="Histórico" component={HistoricoScreen} />
      <Tab.Screen name="Ajustes" component={AjustesScreen} />
    </Tab.Navigator>
  );
}

function AuthenticatedNavigator() {
  useEffect(() => {
    const stopAutoSync = startAutoSync();
    return stopAutoSync;
  }, []);

  return (
    <Stack.Navigator
      screenOptions={screenHeaderOptions}
    >
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
        component={TemplatesRevisaoScreen}
        options={{ title: 'Formulários pendentes' }}
      />
      <Stack.Screen
        name="GerenciarFormularios"
        component={GerenciarFormulariosScreen}
        options={{ title: 'Gerenciar formulários' }}
      />
    </Stack.Navigator>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    // Dispara assim que o app abre, antes mesmo de saber se ja tem sessao —
    // o objetivo e o backend (Render) comecar a acordar do cold start o
    // quanto antes, em paralelo com a checagem de sessao abaixo.
    warmUpBackend();

    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (mounted) {
        setSession(data.session);
        setAuthLoading(false);
      }
    }).catch(() => {
      if (mounted) {
        setSession(null);
        setAuthLoading(false);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        setSession(nextSession);
        setAuthLoading(false);
      },
    );

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  if (authLoading) {
    return null;
  }

  return (
    <NavigationContainer theme={navTheme}>
      {session ? <AuthenticatedNavigator /> : (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Login" component={LoginScreen} />
        </Stack.Navigator>
      )}
    </NavigationContainer>
  );
}