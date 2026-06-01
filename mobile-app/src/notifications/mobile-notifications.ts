import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { buildLocalNotificationData, type DesktopNotificationParams } from './notification-routing';

const ANDROID_CHANNEL_ID = 'braid-desktop';

let channelConfigured = false;

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
