import { AppState, Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// Em builds standalone (EAS), variaveis EXPO_PUBLIC_* so entram no bundle se
// estiverem configuradas no ambiente do build (eas.json "env" ou EAS
// Environment Variables). Se faltarem, nao lancamos erro aqui em cima —
// isso derrubava o app antes mesmo de montar a tela de Login. Em vez disso
// expomos o motivo para a UI decidir o que mostrar.
export const supabaseConfigError: string | null = !SUPABASE_URL || !SUPABASE_ANON_KEY
  ? 'EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY nao definidas neste build.'
  : !__DEV__ && !SUPABASE_URL.startsWith('https://')
    ? 'EXPO_PUBLIC_SUPABASE_URL deve usar HTTPS em producao.'
    : null;

export const supabase = createClient(
  SUPABASE_URL || 'https://placeholder.invalid',
  SUPABASE_ANON_KEY || 'placeholder',
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  },
);

if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
