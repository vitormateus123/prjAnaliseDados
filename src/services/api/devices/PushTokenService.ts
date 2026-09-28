// src/services/api/devices/PushTokenService.ts
// Registra o token do Expo Push API no backend (POST /devices/push-token).
//
// Por que isso existe: o worker de extração offline roda no backend
// (extraction_worker._send_push_notification) e precisa do token do aparelho
// na tabela `push_tokens` para conseguir avisar o usuário DEPOIS que a
// extração terminou, com o app fechado. Sem o registro, o worker processa o
// relatório mas nenhuma notificação chega.
//
// O registro é idempotente: o backend faz upsert em (user_id, expo_push_token).

import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { apiFetch } from '../apiClient';
import { supabase } from '../../auth/supabaseClient';

export interface PushTokenResponse {
  success: boolean;
  error?: string | null;
}

const DEVICE_ID_KEY = '@push/device_id';

function getProjectId(): string | undefined {
  return (
    (Constants.expoConfig?.extra?.eas?.projectId as string | undefined) ??
    (Constants.easConfig?.projectId as string | undefined) ??
    undefined
  );
}

// Identificador estável do install (não da sessão). Serve para desativar
// tokens antigos quando o usuário desinstala/reinstala o app.
// O SDK 57 removeu Constants.installationId, então geramos um UUID e
// persistimos: se o app for reinstalado, o id muda junto.
async function getDeviceId(): Promise<string | null> {
  try {
    const stored = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (stored) return stored;

    const generated = Crypto.randomUUID();
    await AsyncStorage.setItem(DEVICE_ID_KEY, generated);
    return generated;
  } catch {
    // device_id é opcional no backend: falhar aqui não impede o registro.
    return null;
  }
}

/**
 * Garante que o backend conheça o token de push deste aparelho.
 *
 * Deve ser chamada sempre que houver sessão ativa (login OU app reabrindo com
 * sessão salva). Nunca lança: falha de registro de push não pode derrubar o
 * app nem o fluxo de extração.
 *
 * @returns true se o token foi registrado com sucesso.
 */
export async function registerPushToken(): Promise<boolean> {
  // Emulador/simulador não recebe push; não adianta pedir permissão.
  if (!Device.isDevice) {
    if (__DEV__) console.log('[PushToken] não é device físico, pulando');
    return false;
  }

  try {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return false;

    // Pede a permissão se ainda não tiver. Não mostra UI própria: o app já
    // pede permissão em outros fluxos, aqui é apenas uma segunda chance.
    let permission = await Notifications.getPermissionsAsync();
    if (permission.status !== 'granted') {
      permission = await Notifications.requestPermissionsAsync();
    }

    if (permission.status !== 'granted') {
      if (__DEV__) console.log('[PushToken] permissão não concedida');
      return false;
    }

    const projectId = getProjectId();
    const tokenResponse = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    const expoPushToken = tokenResponse.data;

    if (!expoPushToken) {
      if (__DEV__) console.warn('[PushToken] getExpoPushTokenAsync devolveu vazio');
      return false;
    }

    await apiFetch<PushTokenResponse>('/devices/push-token', {
      method: 'POST',
      body: JSON.stringify({
        expo_push_token: expoPushToken,
        device_id: await getDeviceId(),
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
      }),
    });

    if (__DEV__) {
      console.log('[PushToken] registrado com sucesso:', expoPushToken);
    }
    return true;
  } catch (err) {
    // Falha aqui é silenciosa de propósito: o app continua funcionando, só sem
    // notificação quando a extração termina com o app fechado.
    if (__DEV__) console.warn('[PushToken] falha ao registrar token:', err);
    return false;
  }
}

/**
 * Desativa o token deste aparelho. Útil no logout, para o aparelho não receber
 * notificações de outro usuário que entrar depois na mesma conta.
 */
export async function unregisterPushToken(): Promise<void> {
  if (!Device.isDevice) return;

  try {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;

    const permission = await Notifications.getPermissionsAsync();
    if (permission.status !== 'granted') return;

    const projectId = getProjectId();
    const tokenResponse = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    if (!tokenResponse.data) return;

    await apiFetch('/devices/push-token', {
      method: 'DELETE',
      body: JSON.stringify({
        expo_push_token: tokenResponse.data,
        device_id: await getDeviceId(),
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
      }),
    });
  } catch (err) {
    if (__DEV__) console.warn('[PushToken] falha ao remover token:', err);
  }
}
