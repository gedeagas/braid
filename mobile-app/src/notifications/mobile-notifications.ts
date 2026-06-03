import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { buildLocalNotificationData, type DesktopNotificationParams } from './notification-routing';

const ANDROID_CHANNEL_ID = 'braid-desktop';
const PUSH_ENABLED_KEY = 'braid.mobile.pushNotificationsEnabled';
const REMOTE_PUSH_ENABLED_KEY = 'braid.mobile.remotePushEnabled';

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
 * Independent sub-toggle for BACKGROUND (remote) notifications - the ones
 * relayed via Expo/APNs/FCM that arrive when the app is closed. Distinct from the
 * master toggle because these are NOT end-to-end encrypted (content rides
 * third-party push infra), so a user may want in-app/foreground alerts only.
 * When off we never register a push token, so the desktop can't reach this device
 * while it's backgrounded. Defaults to enabled.
 */
export async function loadRemotePushEnabled(): Promise<boolean> {
  const raw = await SecureStore.getItemAsync(REMOTE_PUSH_ENABLED_KEY).catch(() => null);
  return raw === null ? true : raw === 'true';
}

export async function saveRemotePushEnabled(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(REMOTE_PUSH_ENABLED_KEY, enabled ? 'true' : 'false').catch(() => undefined);
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

export interface PushTokenRegistration {
  token: string;
  platform: 'ios' | 'android';
}

/**
 * Tear down this device's APNs/FCM registration entirely, killing the Expo push
 * token app-wide. Call ONLY when no paired desktops remain: any desktop still
 * holding the (now-dead) token gets a `DeviceNotRegistered` receipt on its next
 * push and drops it immediately - which cleans up a desktop that was offline at
 * removal time (so the per-pairing unregister couldn't reach it) without waiting
 * for the token TTL. A later re-pair re-registers a fresh token. Best-effort.
 */
export async function unregisterFromPushAsync(): Promise<void> {
  try {
    await Notifications.unregisterForNotificationsAsync();
  } catch {
    // Not provisioned / never registered: nothing to tear down.
  }
}

/**
 * Acquire this device's Expo push token so the desktop can alert it while the
 * app is backgrounded (the WS is closed then, so the in-app notification path
 * can't reach it). Returns null - and the app simply stays foreground-only -
 * when notifications are disabled/denied, on web/simulator, or when remote push
 * isn't provisioned (Expo Go, missing APNs/FCM credentials), so the caller can
 * treat it as best-effort. Requires a development build with push configured.
 */
export async function registerForPushTokenAsync(): Promise<PushTokenRegistration | null> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return null;
  if (!Device.isDevice) return null; // Push tokens aren't issued on simulators.
  if (!(await loadPushNotificationsEnabled())) return null;
  if (!(await loadRemotePushEnabled())) return null; // background push opted out
  if (!(await ensureNotificationPermissions())) return null;
  configureChannel();
  try {
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const { data } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    return { token: data, platform: Platform.OS };
  } catch {
    // No APNs/FCM entitlement, Expo Go, or offline: background push just won't
    // work yet. Foreground (WS) notifications are unaffected.
    return null;
  }
}
