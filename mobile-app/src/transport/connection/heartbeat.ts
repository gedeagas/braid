// Foreground liveness heartbeat. The desktop runs its own protocol-level ping,
// but that proves nothing about the phone's JS liveness and RN doesn't surface
// pong to JS - an app-level round-trip is the only way the phone can tell its
// own socket died (half-open: TCP gone, no close event).
import type { ManagerInternals } from './internals';
import { reconcile } from './lifecycle';
import { HEARTBEAT_INTERVAL_MS, type Entry } from './types';

export function probeEntry(self: ManagerInternals, entry: Entry): void {
  if (entry.disposed || entry.state !== 'connected' || entry.pingInFlight) return;
  entry.pingInFlight = true;
  entry.client
    .ping()
    .catch(() => {
      if (entry.disposed) return;
      self.pushLog(entry, 'warn', 'Heartbeat timed out', 'Socket presumed dead');
      // Don't trust the cached 'connected' state; close so reconcile sees a
      // dead socket and reconnects.
      entry.client.close();
      entry.state = 'reconnecting';
      self.emit();
      reconcile(self, entry);
    })
    .finally(() => {
      entry.pingInFlight = false;
    });
}

export function startHeartbeat(self: ManagerInternals): void {
  if (self.heartbeatTimer) return;
  self.heartbeatTimer = setInterval(() => {
    for (const entry of self.entries.values()) probeEntry(self, entry);
  }, HEARTBEAT_INTERVAL_MS);
}

export function stopHeartbeat(self: ManagerInternals): void {
  if (self.heartbeatTimer) {
    clearInterval(self.heartbeatTimer);
    self.heartbeatTimer = null;
  }
}
