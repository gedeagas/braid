import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useRef } from 'react';
import { Platform, StatusBar as NativeStatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ClientManagerProvider } from '@/transport/client-manager';
import { loadHosts } from '@/transport/host-store';
import '@/i18n';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { configureNotificationHandler } from '@/notifications/mobile-notifications';
import { getNotificationNavigationPath } from '@/notifications/notification-routing';
import { ThemeProvider, useTheme } from '@/ui/theme';

// Configure foreground presentation once at module load.
configureNotificationHandler();

function useNotificationTapRouting(): void {
  // Both cold-start (last response, replayed via the hook) and warm taps flow
  // through here; the handled-id set dedupes the hook's replay against the
  // listener so a single tap navigates exactly once.
  const lastResponse = Notifications.useLastNotificationResponse();
  const handledRef = useRef<Set<string>>(new Set());

  // Stable identity: a foreground tap fires the listener AND updates
  // useLastNotificationResponse for the same event. If the navigation work were
  // owned by an effect keyed on `lastResponse`, that update would tear the
  // effect down mid-flight (after `loadHosts()` awaited) and a `disposed` guard
  // would swallow the navigate - the exact reason foreground taps stopped
  // routing. Keeping handle() stable and the listener installed once avoids the
  // race; dedup by request id still guarantees a single navigation.
  const handle = useCallback(
    async (response: Notifications.NotificationResponse | null | undefined) => {
      if (!response) return;
      if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;

      const id = response.notification.request.identifier;
      if (handledRef.current.has(id)) return;
      handledRef.current.add(id);

      const hosts = await loadHosts().catch(() => null);
      const path = getNotificationNavigationPath(response.notification.request.content.data, {
        knownHostIds: hosts ? new Set(hosts.map((host) => host.id)) : undefined,
      });
      // navigate (not push): a warm tap reuses the already-mounted terminal
      // screen and just updates its params (worktreePath/terminalId), so the
      // screen reacts and focuses the notification's terminal instead of
      // stacking a duplicate. Cast: typed routes can't statically verify a
      // runtime-built path string.
      if (path) router.navigate(path as Parameters<typeof router.navigate>[0]);
    },
    [],
  );

  // Warm taps while the app is running. Installed once (stable handle), so an
  // in-flight handle() is never aborted by an unrelated re-render.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      void handle(response);
    });
    return () => {
      sub.remove();
    };
  }, [handle]);

  // Cold-start tap (and the hook's replay of a warm tap). Deduped by id against
  // the listener above so we never double-navigate.
  useEffect(() => {
    void handle(lastResponse);
  }, [handle, lastResponse]);
}

// Inner navigator: consumes the active theme so the navigator background and
// the status-bar foreground track light/dark. contentStyle paints the area
// behind the notch during mount/transitions so the safe area stays seamless
// before each screen's own SafeAreaView renders.
function RootNavigator() {
  const { palette, scheme } = useTheme();
  const statusBarStyle = scheme === 'dark' ? 'light' : 'dark';

  useEffect(() => {
    NativeStatusBar.setBarStyle(scheme === 'dark' ? 'light-content' : 'dark-content', true);
    if (Platform.OS === 'android') {
      NativeStatusBar.setBackgroundColor(palette.bg, true);
      NativeStatusBar.setTranslucent(false);
    }
  }, [palette.bg, scheme]);

  return (
    <>
      <StatusBar key={`${scheme}:${palette.bg}`} style={statusBarStyle} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.bg } }} />
    </>
  );
}

export default function RootLayout() {
  useNotificationTapRouting();

  return (
    <ThemeProvider>
      <LanguageProvider>
        <SafeAreaProvider>
          <ClientManagerProvider>
            <RootNavigator />
          </ClientManagerProvider>
        </SafeAreaProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}
