import { router, useFocusEffect } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useCallback, useEffect, useReducer } from 'react';
import { AppState, Linking, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import {
  ensureNotificationPermissions,
  getNotificationPermissionState,
  loadPushNotificationsEnabled,
  savePushNotificationsEnabled,
  type NotificationPermissionState,
} from '@/notifications/mobile-notifications';
import { useShared, useTheme, useThemedStyles, type Palette } from '@/ui/theme';
import { Button, Card, CornerInset, Screen } from '@/ui/kit';

interface State {
  pushEnabled: boolean;
  permission: NotificationPermissionState;
}

const INITIAL: State = {
  pushEnabled: false,
  permission: { granted: false, status: 'undetermined', canAskAgain: true },
};

export default function NotificationsScreen() {
  const { palette: c } = useTheme();
  const shared = useShared();
  const styles = useThemedStyles(makeStyles);
  const [state, patch] = useReducer((prev: State, next: Partial<State>) => ({ ...prev, ...next }), INITIAL);

  const refresh = useCallback(async () => {
    const [pushEnabled, permission] = await Promise.all([
      loadPushNotificationsEnabled(),
      getNotificationPermissionState(),
    ]);
    patch({ pushEnabled, permission });
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
        return;
      }
      patch({ pushEnabled: true, permission });
    } else {
      patch({ pushEnabled: false });
    }
    await savePushNotificationsEnabled(value);
  };

  const blocked = state.permission.status === 'denied';
  const switchOn = state.pushEnabled && state.permission.granted;
  const hint = blocked
    ? 'Notifications are turned off in system settings. Open Settings to allow them.'
    : 'Get a notification when an agent task finishes, needs input, or errors on your desktop.';

  return (
    <Screen edges={['top', 'left', 'right']}>
      <View style={shared.shell}>
        <View style={styles.topRow}>
          <CornerInset />
          <Pressable style={styles.back} onPress={() => router.back()} accessibilityLabel="Back">
            <ChevronLeft color={c.text} size={22} />
          </Pressable>
          <Text style={shared.title}>Notifications</Text>
        </View>

        <Card style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Push notifications</Text>
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
            <Button label="Open Settings" variant="secondary" onPress={() => void Linking.openSettings()} />
          )}
        </Card>
      </View>
    </Screen>
  );
}

function makeStyles(c: Palette) {
  return StyleSheet.create({
    topRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 20 },
    back: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    card: { gap: 12 },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    rowLabel: { color: c.text, fontSize: 16, fontWeight: '700' },
  });
}
