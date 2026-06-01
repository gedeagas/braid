import { router, useFocusEffect } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useCallback, useEffect, useReducer } from 'react';
import { AppState, Linking, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  ensureNotificationPermissions,
  getNotificationPermissionState,
  loadPushNotificationsEnabled,
  savePushNotificationsEnabled,
  type NotificationPermissionState,
} from '@/notifications/mobile-notifications';
import { colors, shared } from '@/ui/theme';

interface State {
  pushEnabled: boolean;
  permission: NotificationPermissionState;
}

const INITIAL: State = {
  pushEnabled: false,
  permission: { granted: false, status: 'undetermined', canAskAgain: true },
};

export default function NotificationsScreen() {
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
    <SafeAreaView style={shared.safe} edges={['top', 'left', 'right']}>
      <View style={shared.shell}>
        <View style={styles.topRow}>
          <Pressable style={styles.back} onPress={() => router.back()} accessibilityLabel="Back">
            <ChevronLeft color={colors.text} size={22} />
          </Pressable>
          <Text style={shared.title}>Notifications</Text>
        </View>

        <View style={[shared.card, styles.card]}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Push notifications</Text>
            <Switch
              value={switchOn}
              disabled={blocked}
              onValueChange={(v) => void togglePush(v)}
              trackColor={{ false: colors.panelStrong, true: colors.accent }}
              thumbColor={colors.text}
            />
          </View>
          <Text style={shared.muted}>{hint}</Text>
          {blocked && (
            <Pressable style={[shared.button, shared.secondary, styles.settingsButton]} onPress={() => void Linking.openSettings()}>
              <Text style={shared.buttonText}>Open Settings</Text>
            </Pressable>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 20 },
  back: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  card: { gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowLabel: { color: colors.text, fontSize: 16, fontWeight: '700' },
  settingsButton: { alignSelf: 'flex-start', marginTop: 4 },
});
