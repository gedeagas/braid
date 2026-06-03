// App-level shared connection manager. Braid's desktop closes any existing
// connection from the same device on a new auth, so we cannot open one socket
// per screen plus a separate one for notifications - everything must ride a
// single shared BraidRpcClient per host. The manager owns each client's
// lifecycle: it connects lazily, keeps the socket alive while the app is
// foregrounded (with a liveness heartbeat), subscribes to desktop
// notifications, and reconciles toward the desired state on every trigger.
import type { AppStateStatus } from 'react-native';

import { loadHosts } from '@/transport/host-store';
import { BraidRpcClient } from '@/transport/rpc-client';
import { MOBILE_CAPABILITY } from '@/transport/protocol-version';
import type { ConnectionLogEntry } from '@/transport/connection-health';
import type { PairedHost } from '@/transport/types';

import { createInternals } from './internals';
import { connectEntry, endpointDetail, makeEntry, reconcile, reconcileAll } from './lifecycle';
import { probeEntry, startHeartbeat, stopHeartbeat } from './heartbeat';
import { desktopSupports, registerPush } from './notifications';
import type { ClientManager, HostConnectionState, ManagerDeps } from './types';

export type InternalManager = ClientManager & {
  init: () => Promise<void>;
  onAppState: (state: AppStateStatus) => void;
  disposeAll: () => void;
};

export function createManager(deps: ManagerDeps = {}): InternalManager {
  const self = createInternals(deps);
  const { entries } = self;

  const acquireHost = (host: PairedHost): BraidRpcClient => {
    let entry = entries.get(host.id);
    // The client mutates host.id from the pairing-offer id to the real deviceId
    // after the first auth (rpc-client.ts). The desktop allows one connection per
    // device, so a *second* entry for the same desktop (same endpoint) would make
    // the two sockets evict each other in an infinite loop - the classic
    // first-pair connect loop. Before creating a new entry, reuse an existing one
    // for this endpoint and re-key it under the (possibly new) id.
    if (!entry) {
      for (const [key, existing] of entries) {
        if (existing.host.endpoint !== host.endpoint) continue;
        entry = existing;
        entry.host = host;
        if (key !== host.id) {
          entries.delete(key);
          entries.set(host.id, entry);
        }
        break;
      }
    }
    if (!entry) {
      entry = makeEntry(self, host);
      entries.set(host.id, entry);
    } else {
      entry.host = host;
    }
    // A screen mounting is itself a reconcile trigger: connect a fresh entry, or
    // revive one whose socket died while the manager wasn't looking.
    reconcile(self, entry);
    self.emit();
    return entry.client;
  };

  const getClient = (hostId: string): BraidRpcClient | null => entries.get(hostId)?.client ?? null;

  const getState = (hostId: string): HostConnectionState => entries.get(hostId)?.state ?? 'disconnected';

  const getReconnectAttempt = (hostId: string): number => entries.get(hostId)?.attempt ?? 0;

  const getLastConnectedAt = (hostId: string): number | null => entries.get(hostId)?.lastConnectedAt ?? null;

  const getConnectionLog = (hostId: string): ConnectionLogEntry[] => entries.get(hostId)?.log ?? [];

  const forceReconnect = (hostId: string): void => {
    const entry = entries.get(hostId);
    if (!entry || entry.disposed) return;
    if (entry.reconnectTimer) {
      clearTimeout(entry.reconnectTimer);
      entry.reconnectTimer = null;
    }
    // Reset the streak so the verdict de-escalates from "Can't reach desktop"
    // and the backoff starts fresh, then reconnect right away.
    entry.attempt = 0;
    self.pushLog(entry, 'info', 'Manual reconnect', endpointDetail(entry));
    connectEntry(self, entry);
  };

  const unregisterPush = async (hostId: string): Promise<void> => {
    const entry = entries.get(hostId);
    if (!entry) return;
    // The desktop only learns to drop our token over a live socket. On the
    // homepage the app is foregrounded and usually already (re)connecting, so
    // give it a brief window to finish before giving up - a "remove" right after
    // opening the app still lands. If the desktop is genuinely unreachable we
    // proceed anyway: it isn't pushing while offline, and its token TTL expires
    // us if it never sees this device again.
    if (entry.state !== 'connected') {
      if (entry.reconnectTimer) {
        clearTimeout(entry.reconnectTimer);
        entry.reconnectTimer = null;
      }
      await new Promise<void>((resolve) => {
        // `off` is declared first and guarded so a (hypothetical) synchronous
        // onOpen can't reference it before assignment.
        let off: (() => void) | undefined;
        const timer = setTimeout(() => {
          off?.();
          resolve();
        }, 4000);
        off = entry.client.onOpen(() => {
          clearTimeout(timer);
          off?.();
          resolve();
        });
        // Kick a connect unless one is already in flight (don't reset it).
        if (entry.state !== 'connecting') {
          entry.attempt = 0;
          connectEntry(self, entry);
        }
      });
    }
    if (!(await desktopSupports(entry, MOBILE_CAPABILITY.pushNotifications))) return;
    await entry.client.request('notifications.unregisterPush').catch(() => undefined);
  };

  const syncPushRegistration = async (enabled: boolean): Promise<void> => {
    for (const entry of entries.values()) {
      if (entry.state !== 'connected') continue;
      if (!(await desktopSupports(entry, MOBILE_CAPABILITY.pushNotifications))) continue;
      if (enabled) {
        registerPush(entry);
      } else {
        await entry.client.request('notifications.unregisterPush').catch(() => undefined);
      }
    }
  };

  const dropHost = (hostId: string): void => {
    const entry = entries.get(hostId);
    if (!entry) return;
    entry.disposed = true;
    if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer);
    entry.offNotification?.();
    entry.offNotification = null;
    entry.offClose?.();
    entry.offOpen?.();
    entry.client.clearSubscriptions();
    entry.client.close();
    entries.delete(hostId);
    self.emit();
  };

  const subscribe = (listener: () => void): (() => void) => {
    self.listeners.add(listener);
    return () => {
      self.listeners.delete(listener);
    };
  };

  const subscribeActivity = (listener: (hostId: string) => void): (() => void) => {
    self.activityListeners.add(listener);
    return () => {
      self.activityListeners.delete(listener);
    };
  };

  const init = async (): Promise<void> => {
    // Cold start: the app is already foregrounded, so no 'active' AppState event
    // fires. Arm the heartbeat here so liveness probing runs from launch.
    startHeartbeat(self);
    try {
      const hosts = await loadHosts();
      for (const host of hosts) acquireHost(host);
    } catch {
      // Keychain can fail mid-unlock on cold start; screens re-acquire on mount.
    }
  };

  const onAppState = (state: AppStateStatus): void => {
    if (state === 'active') {
      // Returning to the foreground: we want everything connected again. Set the
      // desired state and reconcile - which, crucially, reconnects entries whose
      // socket died silently while suspended (isOpen() is false even though the
      // cached state may still read 'connected'). No reliance on having observed
      // a matching 'background' event first, so a missed/coalesced transition
      // can't strand a dead socket. 'auth-failed' is preserved by reconcile.
      self.desiredConnected = true;
      startHeartbeat(self);
      reconcileAll(self);
      // Probe immediately too: the 20s heartbeat tick would otherwise leave a
      // brief window where a just-resumed half-open socket reads connected.
      for (const entry of entries.values()) probeEntry(self, entry);
    } else if (state === 'background') {
      // iOS suspends sockets when backgrounded; close cleanly and reconnect on
      // return. 'inactive' is intentionally ignored (transient, e.g. the
      // notification shade) to avoid needless churn.
      self.desiredConnected = false;
      stopHeartbeat(self);
      // Keep the notification routing listener and tracked subscriptions in
      // place; close() preserves them and resendSubscriptions() replays on the
      // next foreground connect. reconcile() emits 'close' for every non-idle
      // entry and preserves 'auth-failed'.
      reconcileAll(self);
    }
  };

  const disposeAll = (): void => {
    stopHeartbeat(self);
    for (const id of [...entries.keys()]) dropHost(id);
  };

  return {
    acquireHost,
    getClient,
    getState,
    getReconnectAttempt,
    getLastConnectedAt,
    getConnectionLog,
    forceReconnect,
    dropHost,
    unregisterPush,
    syncPushRegistration,
    subscribe,
    subscribeActivity,
    init,
    onAppState,
    disposeAll,
  };
}
