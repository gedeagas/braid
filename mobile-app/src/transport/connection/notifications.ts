// Desktop-notification routing, capability negotiation, and push-token
// registration. These ride the shared per-host client and survive reconnects.
import { MOBILE_CAPABILITY } from '@/transport/protocol-version';
import type { RpcNotification } from '@/transport/types';
import { registerForPushTokenAsync, scheduleDesktopNotification } from '@/notifications/mobile-notifications';
import type { DesktopNotificationParams } from '@/notifications/notification-routing';

import type { ManagerInternals } from './internals';
import type { Entry } from './types';

// The notification-routing listener is registered once per entry (it survives
// close()/reconnect since the client doesn't clear notificationListeners).
export function startNotificationRouting(self: ManagerInternals, entry: Entry): void {
  if (entry.offNotification) return;
  entry.offNotification = entry.client.onNotification((message: RpcNotification) => {
    if (message.method !== 'notification') return;
    void scheduleDesktopNotification(message.params as DesktopNotificationParams, entry.host.id);
    // Wake any home-screen listener so its "Needs attention" list refreshes
    // against the host's now-updated terminal states.
    self.emitActivity(entry.host.id);
  });
}

// Subscribe to desktop notifications once. On later reconnects the client's
// resendSubscriptions() replays this automatically, so we never re-subscribe.
//
// Fire-and-forget: the notification subscription lives for the whole
// connection, so we never unsubscribe it explicitly (and thus don't track the
// returned id). dropHost()'s clearSubscriptions() + close() tears it down, and
// the desktop drops every subscription when the socket closes - so an explicit
// notifications.unsubscribe RPC would only race that close, never beat it.
export function subscribeNotifications(entry: Entry): void {
  entry.client.subscribe('notifications.subscribe').catch(() => {
    // Retried on the next reconnect via resendSubscriptions().
  });
}

// Fetch (and cache for this connection) the desktop's advertised capabilities,
// so we can gate capability-negotiated calls instead of firing RPCs an older
// desktop lacks (which the desktop answers with method-not-found - logged as an
// error even when the caller catches it). status.get is a core method present
// on every desktop; one that predates the capabilities field returns none, so
// the feature reads as unsupported.
export async function desktopSupports(entry: Entry, capability: string): Promise<boolean> {
  if (entry.capabilities == null) {
    const status = await entry.client.request<{ capabilities?: string[] }>('status.get').catch(() => null);
    if (entry.disposed) return false;
    entry.capabilities = status?.capabilities ?? [];
  }
  return entry.capabilities.includes(capability);
}

// Hand the desktop this device's Expo push token so it can alert us while
// backgrounded (the socket is closed then). Fire-and-forget and best-effort:
// gated on the desktop advertising push support (so we never call a method an
// older desktop lacks), and skipped when the device has no token (push disabled
// or not provisioned). Called on every connect so the desktop's freshness
// heartbeat stays current.
export function registerPush(entry: Entry): void {
  void (async () => {
    if (entry.disposed) return;
    if (!(await desktopSupports(entry, MOBILE_CAPABILITY.pushNotifications))) return;
    const reg = await registerForPushTokenAsync();
    if (!reg || entry.disposed) return;
    await entry.client.request('notifications.registerPush', { token: reg.token, platform: reg.platform }).catch(() => undefined);
  })();
}
