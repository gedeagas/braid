import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useReducer } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Linking, StyleSheet, Switch, Text, View } from 'react-native';

import {
  ensureNotificationPermissions,
  getNotificationPermissionState,
  loadPushNotificationsEnabled,
  loadRemotePushEnabled,
  savePushNotificationsEnabled,
  saveRemotePushEnabled,
  type NotificationPermissionState,
} from '@/notifications/mobile-notifications';
import { useClientManager } from '@/transport/client-manager';
import { useShared, useTheme, useThemedStyles, type Palette } from '@/ui/theme';
import { Button, Card, Screen, ScreenHeader } from '@/ui/kit';

interface State {
  pushEnabled: boolean;
  remotePushEnabled: boolean;
  permission: NotificationPermissionState;
}

const INITIAL: State = {
  pushEnabled: false,
  remotePushEnabled: true,
  permission: { granted: false, status: 'undetermined', canAskAgain: true },
};

export default function NotificationsScreen() {
  const { t } = useTranslation();
  const { palette: c } = useTheme();
  const shared = useShared();
  const styles = useThemedStyles(makeStyles);
  const manager = useClientManager();
  const [state, patch] = useReducer((prev: State, next: Partial<State>) => ({ ...prev, ...next }), INITIAL);

  const refresh = useCallback(async () => {
    const [pushEnabled, remotePushEnabled, permission] = await Promise.all([
      loadPushNotificationsEnabled(),
      loadRemotePushEnabled(),
      getNotificationPermissionState(),
    ]);
    patch({ pushEnabled, remotePushEnabled, permission });
  }, []);

  // Re-check on focus and when returning from the system Settings app, so the
  // toggle reflects a permission the user changed outside the app.
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const togglePush = async (value: boolean) => {
    if (value) {
      const granted = await ensureNotificationPermissions();
      const permission = await getNotificationPermissionState();
      if (!granted) {
        patch({ pushEnabled: false, permission });
        await savePushNotificationsEnabled(false);
        // Nothing was registered, but stay defensive and clear any token.
        void manager.syncPushRegistration(false);
        return;
      }
      patch({ pushEnabled: true, permission });
    } else {
      patch({ pushEnabled: false });
    }
    await savePushNotificationsEnabled(value);
    // Push the change to connected desktops: register the token only when the
    // master AND the background sub-toggle are on; otherwise have every desktop
    // forget it (remote pushes show via the OS regardless of in-app state, so
    // disabling must reach the desktop).
    void manager.syncPushRegistration(value && state.remotePushEnabled);
  };

  const toggleRemotePush = async (value: boolean) => {
    patch({ remotePushEnabled: value });
    await saveRemotePushEnabled(value);
    // Only register when the master is also on and permission is granted.
    void manager.syncPushRegistration(value && state.pushEnabled && state.permission.granted);
  };

  const blocked = state.permission.status === 'denied';
  const switchOn = state.pushEnabled && state.permission.granted;
  const hint = blocked
    ? t('notifications.hintBlocked')
    : t('notifications.hint');

  return (
    <Screen edges={['top', 'left', 'right']}>
      <View style={shared.shell}>
        <ScreenHeader title={t('notifications.title')} back style={styles.topRow} />

        <Card style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>{t('notifications.pushLabel')}</Text>
            <Switch
              value={switchOn}
              disabled={blocked}
              onValueChange={(v) => void togglePush(v)}
              trackColor={{ false: c.panelStrong, true: c.accent }}
              thumbColor={c.text}
            />
          </View>
          <Text style={shared.muted}>{hint}</Text>
          {blocked && (
            <Button label={t('notifications.openSettings')} variant="secondary" onPress={() => void Linking.openSettings()} />
          )}
        </Card>

        <Card style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>{t('notifications.backgroundLabel')}</Text>
            <Switch
              value={switchOn && state.remotePushEnabled}
              disabled={!switchOn}
              onValueChange={(v) => void toggleRemotePush(v)}
              trackColor={{ false: c.panelStrong, true: c.accent }}
              thumbColor={c.text}
            />
          </View>
          <Text style={shared.muted}>{t('notifications.backgroundHint')}</Text>
        </Card>
      </View>
    </Screen>
  );
}

function makeStyles(c: Palette) {
  return StyleSheet.create({
    topRow: { marginBottom: 20 },
    card: { gap: 12 },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    rowLabel: { color: c.text, fontSize: 16, fontWeight: '700' },
  });
}
