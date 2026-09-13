// App.tsx
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';

import { FormSelectScreen } from './src/screens/FormSelectScreen';
import CapturaScreen from './src/screens/Captura';
import { RevisaoScreen } from './src/screens/RevisaoScreen';
import HistoricoScreen from './src/screens/Historico';
import AjustesScreen from './src/screens/Ajustes';

// Tabs da tela "Principal"
export type MainTabParamList = {
  'Histórico': undefined;
  Ajustes: undefined;
};

// Pilha raiz do app
export type RootStackParamList = {
  Principal: { screen?: keyof MainTabParamList } | undefined;
  FormSelect: undefined;
  Captura: { formTemplateId: string };
  Revisao: { reportId: string; extractionFailed?: boolean };
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarIcon: ({ color, size }) => {
          const iconName =
            route.name === 'Histórico' ? 'time-outline' : 'settings-outline';
          return <Ionicons name={iconName} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Histórico" component={HistoricoScreen} />
      <Tab.Screen name="Ajustes" component={AjustesScreen} />
    </Tab.Navigator>
  );
}

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen
          name="Principal"
          component={MainTabs}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="FormSelect"
          component={FormSelectScreen}
          options={{ title: 'Novo Relatório' }}
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
      </Stack.Navigator>
    </NavigationContainer>
  );
}