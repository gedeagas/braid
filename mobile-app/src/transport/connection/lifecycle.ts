// Per-host connection lifecycle: opening sockets, the connect/reconnect state
// machine, and the idempotent reconcile that drives an entry toward the desired
// state. The reconcile decision itself is the pure decideReconcile().
import { BraidAuthError } from '@/transport/rpc-client';
import { decideReconcile } from '@/transport/connection-reconcile';
import type { PairedHost } from '@/transport/types';

import type { ManagerInternals } from './internals';
import { registerPush, startNotificationRouting, subscribeNotifications } from './notifications';
import { GIVE_UP_AFTER_ATTEMPTS, RECONNECT_BASE_MS, RECONNECT_MAX_MS, type Entry } from './types';

export const endpointDetail = (entry: Entry): string => entry.host.endpoint;

export function scheduleReconnect(self: ManagerInternals, entry: Entry): void {
  if (entry.disposed || !self.desiredConnected || entry.reconnectTimer) return;
  // Give up after a long unreachable streak. The state stays 'reconnecting' so
  // classifyConnection() reports "Can't reach desktop" (attempt >= cap) and the
  // UI surfaces Reconnect / Re-pair; forceReconnect() resets the counter.
  if (entry.attempt >= GIVE_UP_AFTER_ATTEMPTS) {
    self.pushLog(entry, 'error', 'Stopped reconnecting', `Unreachable after ${entry.attempt} attempts`);
    self.emit();
    return;
  }
  entry.attempt += 1;
  // Exponential backoff with jitter, capped, so a genuinely-down host isn't
  // hammered and multiple hosts don't reconnect in lockstep.
  const backoff = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** (entry.attempt - 1));
  const delay = backoff + Math.floor(Math.random() * 250);
  self.pushLog(entry, 'info', `Reconnect scheduled in ${Math.round(delay / 100) / 10}s`, `Attempt ${entry.attempt}`);
  entry.reconnectTimer = setTimeout(() => {
    entry.reconnectTimer = null;
    if (entry.disposed || !self.desiredConnected) return;
    connectEntry(self, entry);
  }, delay);
}

// Single source of truth for "the socket just authenticated". Driven by the
// client's onOpen event so it fires no matter who called connect() - the
// manager's own connectEntry OR a screen's direct load()/pull-to-refresh.
// Idempotent: re-entry for an already-connected entry only refreshes the
// timestamp, so subscriptions aren't double-sent when connectEntry's promise
// resolves right after onOpen.
export function markConnected(self: ManagerInternals, entry: Entry): void {
  if (entry.disposed) return;
  if (entry.state === 'connected') {
    entry.lastConnectedAt = Date.now();
    return;
  }
  const elapsed = entry.connectStartedAt ? Date.now() - entry.connectStartedAt : null;
  entry.state = 'connected';
  entry.attempt = 0;
  entry.lastConnectedAt = Date.now();
  entry.connectStartedAt = null;
  self.pushLog(entry, 'success', 'Connected', elapsed != null ? `in ${Math.round(elapsed / 100) / 10}s` : undefined);
  if (entry.everConnected) {
    // Reconnect: replay every tracked subscription (terminals + notifications)
    // so live streams resume without each screen re-subscribing itself.
    entry.client.resendSubscriptions();
  } else {
    entry.everConnected = true;
    subscribeNotifications(entry);
  }
  // Re-register the push token on every connect (not just the first) so the
  // desktop refreshes its freshness timestamp. The desktop expires tokens that
  // haven't been seen within its TTL, so a device that's gone (removed while
  // offline, uninstalled) stops getting pushes; an active one keeps them alive
  // by reconnecting whenever the app is opened.
  registerPush(entry);
  self.emit();
}

export function connectEntry(self: ManagerInternals, entry: Entry): void {
  // Reset transport state (nonce counter, listeners) before each (re)connect.
  entry.client.close();
  // Capabilities are per-connection; refetch after this (re)connect in case the
  // desktop was upgraded since we last saw it.
  entry.capabilities = null;
  // First attempt reads as 'connecting'; subsequent attempts as 'reconnecting'
  // so classifyConnection() can escalate the verdict as the streak grows.
  entry.state = entry.attempt > 0 ? 'reconnecting' : 'connecting';
  entry.connectStartedAt = Date.now();
  entry.connectInFlight = true;
  self.pushLog(entry, 'info', entry.attempt > 0 ? 'Reconnecting' : 'Opening connection', endpointDetail(entry));
  self.emit();
  entry.client
    .connect()
    .then(() => {
      entry.connectInFlight = false;
      // onOpen has usually already run markConnected; this is a safety net for
      // the case where the listener was somehow missed.
      markConnected(self, entry);
    })
    .catch((error: unknown) => {
      entry.connectInFlight = false;
      if (entry.disposed) return;
      // A rejected/revoked pairing is terminal: park in 'auth-failed' and do
      // NOT reconnect (retrying a dead token only churns). The UI shows a
      // re-pair banner; forceReconnect() is the only way out.
      if (error instanceof BraidAuthError) {
        entry.state = 'auth-failed';
        self.pushLog(entry, 'error', 'Pairing rejected', error.message);
        self.emit();
        return;
      }
      entry.state = 'reconnecting';
      self.pushLog(entry, 'warn', 'Connect failed', error instanceof Error ? error.message : String(error));
      self.emit();
      scheduleReconnect(self, entry);
    });
}

export function makeEntry(self: ManagerInternals, host: PairedHost): Entry {
  const client = self.createClient(host);
  const entry: Entry = {
    host,
    client,
    state: 'disconnected',
    attempt: 0,
    offNotification: null,
    offClose: null,
    offOpen: null,
    reconnectTimer: null,
    connectInFlight: false,
    pingInFlight: false,
    disposed: false,
    everConnected: false,
    lastConnectedAt: null,
    connectStartedAt: null,
    log: [],
    capabilities: null,
  };
  // Register notification routing once; it survives reconnects (the client
  // keeps notificationListeners across close()), so we never tear it down
  // except when the host is permanently dropped.
  startNotificationRouting(self, entry);
  // Sync state from any successful handshake, even screen-initiated ones, so a
  // direct load()/refresh that revives a parked socket clears the error verdict
  // (and its connection-log panel) instead of leaving it stuck.
  entry.offOpen = client.onOpen(() => markConnected(self, entry));
  entry.offClose = client.onClose((reason) => {
    if (entry.disposed) return;
    // Token revoked mid-session: the desktop closed with 4001. Park in
    // 'auth-failed' rather than reconnecting with the now-dead token.
    if (reason.authFailed) {
      entry.state = 'auth-failed';
      self.pushLog(entry, 'error', 'Pairing rejected', 'Desktop closed the connection (4001)');
      self.emit();
      return;
    }
    // Superseded (4000): a newer connection from this device took over (the
    // desktop allows one per device). Do NOT reconnect - reconnecting here is
    // what creates the infinite connect loop when a duplicate client briefly
    // exists. The newer connection is the live one.
    if (reason.superseded) {
      entry.state = 'disconnected';
      self.pushLog(entry, 'info', 'Connection superseded', 'Replaced by a newer connection (4000)');
      self.emit();
      return;
    }
    entry.state = 'reconnecting';
    self.pushLog(entry, 'warn', 'Connection dropped', 'Will attempt to reconnect');
    self.emit();
    scheduleReconnect(self, entry);
  });
  return entry;
}

// Idempotent: drive a single entry toward the desired state. Safe to call on
// any trigger (foreground, screen mount, heartbeat failure) - it inspects the
// live socket via client.isOpen() rather than trusting the cached state, so a
// half-open socket the OS killed silently is detected and reconnected.
export function reconcile(self: ManagerInternals, entry: Entry): void {
  if (entry.disposed) return;
  const action = decideReconcile({
    desiredConnected: self.desiredConnected,
    state: entry.state,
    socketOpen: entry.client.isOpen(),
    connectInFlight: entry.connectInFlight,
    reconnectScheduled: entry.reconnectTimer != null,
  });
  switch (action) {
    case 'connect':
      entry.attempt = 0;
      connectEntry(self, entry);
      break;
    case 'reconnect':
      // A dead/half-open socket: reset the streak and reconnect immediately.
      self.pushLog(entry, 'warn', 'Socket not live on reconcile', 'Reconnecting');
      entry.attempt = 0;
      connectEntry(self, entry);
      break;
    case 'close':
      if (entry.reconnectTimer) {
        clearTimeout(entry.reconnectTimer);
        entry.reconnectTimer = null;
      }
      if (entry.state !== 'auth-failed') entry.state = 'disconnected';
      entry.client.close();
      break;
    case 'none':
      break;
  }
}

export function reconcileAll(self: ManagerInternals): void {
  for (const entry of self.entries.values()) reconcile(self, entry);
  self.emit();
}
