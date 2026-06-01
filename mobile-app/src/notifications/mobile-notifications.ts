import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { buildLocalNotificationData, type DesktopNotificationParams } from './notification-routing';

const ANDROID_CHANNEL_ID = 'braid-desktop';
const PUSH_ENABLED_KEY = 'braid.mobile.pushNotificationsEnabled';

let channelConfigured = false;

export interface NotificationPermissionState {
  granted: boolean;
  /** Raw OS status: 'granted' | 'denied' | 'undetermined'. */
  status: string;
  /** False once the OS will no longer show the prompt (user must use Settings). */
  canAskAgain: boolean;
}

export async function getNotificationPermissionState(): Promise<NotificationPermissionState> {
  const { status, canAskAgain, granted } = await Notifications.getPermissionsAsync();
  return { granted, status, canAskAgain };
}

/**
 * User-facing on/off toggle for desktop notifications, persisted across launches.
 * Defaults to enabled so a freshly paired device still surfaces alerts (the OS
 * permission prompt then gates actual delivery).
 */
export async function loadPushNotificationsEnabled(): Promise<boolean> {
  const raw = await SecureStore.getItemAsync(PUSH_ENABLED_KEY).catch(() => null);
  return raw === null ? true : raw === 'true';
}

export async function savePushNotificationsEnabled(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(PUSH_ENABLED_KEY, enabled ? 'true' : 'false').catch(() => undefined);
}

/**
 * Foreground presentation. Without this, expo-notifications silently drops
 * notifications while the app is open - which is exactly when our WebSocket
 * subscription is delivering them.
 */
export function configureNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

function configureChannel(): void {
  if (channelConfigured || Platform.OS !== 'android') return;
  channelConfigured = true;
  void Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'Desktop notifications',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250],
    lightColor: '#3D8BFF',
  });
}

export async function ensureNotificationPermissions(): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  if (!existing.canAskAgain) return false;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

/**
 * Raises a local OS notification for a desktop event. Embeds deep-link data so
 * a tap can open the exact terminal tab.
 */
export async function scheduleDesktopNotification(
  params: DesktopNotificationParams,
  hostId: string,
): Promise<void> {
  if (!(await loadPushNotificationsEnabled())) return;
  configureChannel();
  const granted = await ensureNotificationPermissions();
  if (!granted) return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: params.title || 'Braid',
      body: params.body || '',
      data: buildLocalNotificationData(params, hostId),
      ...(Platform.OS === 'android' ? { channelId: ANDROID_CHANNEL_ID } : {}),
    },
    trigger: null,
  });
}
