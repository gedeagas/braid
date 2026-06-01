import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef } from 'react';

import { ClientManagerProvider } from '@/transport/client-manager';
import { loadHosts } from '@/transport/host-store';
import { configureNotificationHandler } from '@/notifications/mobile-notifications';
import { getNotificationNavigationPath } from '@/notifications/notification-routing';

// Configure foreground presentation once at module load.
configureNotificationHandler();

function useNotificationTapRouting(): void {
  // Both cold-start (last response, replayed via the hook) and warm taps flow
  // through here; the handled-id set dedupes the hook's replay against the
  // listener.
  const lastResponse = Notifications.useLastNotificationResponse();
  const handledRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let disposed = false;

    async function handle(response: Notifications.NotificationResponse | null | undefined) {
      if (!response) return;
      if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;

      const id = response.notification.request.identifier;
      if (handledRef.current.has(id)) return;
      handledRef.current.add(id);

      const hosts = await loadHosts().catch(() => null);
      const path = getNotificationNavigationPath(response.notification.request.content.data, {
        knownHostIds: hosts ? new Set(hosts.map((host) => host.id)) : undefined,
      });
      // Cast: typed routes can't statically verify a runtime-built path string.
      if (!disposed && path) router.push(path as Parameters<typeof router.push>[0]);
    }

    void handle(lastResponse);
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      void handle(response);
    });
    return () => {
      disposed = true;
      sub.remove();
    };
  }, [lastResponse]);
}

export default function RootLayout() {
  useNotificationTapRouting();

  return (
    <ClientManagerProvider>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }} />
    </ClientManagerProvider>
  );
}
