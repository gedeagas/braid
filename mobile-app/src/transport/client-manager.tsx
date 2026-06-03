// App-level shared connection manager. Braid's desktop closes any existing
// connection from the same device on a new auth, so we cannot open one socket
// per screen plus a separate one for notifications - everything must ride a
// single shared BraidRpcClient per host. This provider owns that client's
// lifecycle: it connects lazily, keeps the socket alive while the app is
// foregrounded, subscribes to desktop notifications, and reconnects on drop.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { loadHosts } from '@/transport/host-store';
import { BraidAuthError, BraidRpcClient } from '@/transport/rpc-client';
import type { ConnectionLogEntry, ConnectionLogLevel, ConnectionState } from '@/transport/connection-health';
import { MOBILE_CAPABILITY } from '@/transport/protocol-version';
import type { PairedHost, RpcNotification } from '@/transport/types';
import { registerForPushTokenAsync, scheduleDesktopNotification } from '@/notifications/mobile-notifications';
import type { DesktopNotificationParams } from '@/notifications/notification-routing';

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
// Why: stop auto-retrying once the host is clearly unreachable for a long time
// (wrong IP, port closed, host moved) so a phone on the home screen doesn't burn
// a socket open forever. MUST stay aligned with connection-health.ts
// UNREACHABLE_ATTEMPTS so the "Can't reach desktop" verdict appears exactly when
// the loop parks. The UI then offers Reconnect (resets the counter) or Re-pair.
const GIVE_UP_AFTER_ATTEMPTS = 12;
// Bounded ring buffer of recent connection events per host, shown in the host
// screen / troubleshooter so a user can see why connecting is stuck.
const CONNECTION_LOG_LIMIT = 40;

export type HostConnectionState = ConnectionState;

interface Entry {
  host: PairedHost;
  client: BraidRpcClient;
  state: HostConnectionState;
  /** Consecutive failed/dropped connect attempts; drives reconnect backoff. */
  attempt: number;
  offNotification: (() => void) | null;
  offClose: (() => void) | null;
  offOpen: (() => void) | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  disposed: boolean;
  /** True once the first successful connect has happened (drives replay vs initial subscribe). */
  everConnected: boolean;
  /** Epoch ms of the last successful connect; null until first connect. Drives the stale verdict. */
  lastConnectedAt: number | null;
  /** Wall-clock of the in-flight connect attempt, for "connected after Ns" log detail. */
  connectStartedAt: number | null;
  /** Bounded ring buffer of recent connection events (newest last). */
  log: ConnectionLogEntry[];
  /** Desktop capabilities from status.get, fetched once per connection (null
   *  until fetched, reset on each reconnect). Gates capability-negotiated calls
   *  like push registration so we don't fire RPCs an older desktop lacks. */
  capabilities: string[] | null;
}

export interface ClientManager {
  /** Get-or-create the shared client for a host and keep it alive. */
  acquireHost: (host: PairedHost) => BraidRpcClient;
  getClient: (hostId: string) => BraidRpcClient | null;
  dropHost: (hostId: string) => void;
  /**
   * Tell the desktop to forget this device's push token so it stops sending
   * background notifications. Best-effort and only effective while connected;
   * call it before dropHost on host removal so a removed desktop goes quiet
   * (otherwise the desktop keeps the token and keeps pushing to the phone).
   */
  unregisterPush: (hostId: string) => Promise<void>;
  /**
   * Apply the device-wide "desktop notifications" toggle to every connected
   * desktop: register this device's push token everywhere when enabled, or tell
   * every desktop to forget it when disabled. Disabling must reach the desktop
   * because remote pushes are shown by the OS regardless of in-app state.
   */
  syncPushRegistration: (enabled: boolean) => Promise<void>;
  /** Current connection state for a host (for UI status). */
  getState: (hostId: string) => HostConnectionState;
  /** Consecutive failed reconnect attempts (0 when connected/idle). */
  getReconnectAttempt: (hostId: string) => number;
  /** Epoch ms of the last successful connect, or null if never connected this session. */
  getLastConnectedAt: (hostId: string) => number | null;
  /** Recent connection events for a host (oldest first), for the troubleshooter. */
  getConnectionLog: (hostId: string) => ConnectionLogEntry[];
  /**
   * Force an immediate fresh connect: clears any auth-failed/give-up state and
   * resets the retry counter. Used by the "Reconnect" affordance after the loop
   * has parked or the pairing was rejected.
   */
  forceReconnect: (hostId: string) => void;
  /** Subscribe to connection-state changes (for UI re-renders). */
  subscribe: (listener: () => void) => () => void;
  /**
   * Subscribe to desktop `notification` events (agent done / needs-input). The
   * home screen uses this to live-refresh a host's terminal states - and thus
   * its "Needs attention" list - the moment an event arrives.
   */
  subscribeActivity: (listener: (hostId: string) => void) => () => void;
}

function createManager(): ClientManager & {
  init: () => Promise<void>;
  onAppState: (state: AppStateStatus) => void;
  disposeAll: () => void;
} {
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  const activityListeners = new Set<(hostId: string) => void>();
  let foregrounded = true;
  let logSeq = 0;

  const emit = () => {
    for (const listener of listeners) listener();
  };

  const emitActivity = (hostId: string) => {
    for (const listener of activityListeners) listener(hostId);
  };

  // Append a bounded connection-log entry. Newest entries live at the end; the
  // ring buffer is trimmed from the front so the log can't grow unbounded over a
  // long-lived session of reconnect churn.
  const pushLog = (entry: Entry, level: ConnectionLogLevel, message: string, detail?: string): void => {
    entry.log.push({ id: `clog-${++logSeq}`, ts: Date.now(), level, message, detail });
    if (entry.log.length > CONNECTION_LOG_LIMIT) entry.log.splice(0, entry.log.length - CONNECTION_LOG_LIMIT);
  };

  const endpointDetail = (entry: Entry): string => entry.host.endpoint;

  // The notification-routing listener is registered once per entry (it survives
  // close()/reconnect since the client doesn't clear notificationListeners).
  function startNotificationRouting(entry: Entry): void {
    if (entry.offNotification) return;
    entry.offNotification = entry.client.onNotification((message: RpcNotification) => {
      if (message.method !== 'notification') return;
      void scheduleDesktopNotification(message.params as DesktopNotificationParams, entry.host.id);
      // Wake any home-screen listener so its "Needs attention" list refreshes
      // against the host's now-updated terminal states.
      emitActivity(entry.host.id);
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
  function subscribeNotifications(entry: Entry): void {
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
  async function desktopSupports(entry: Entry, capability: string): Promise<boolean> {
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
  function registerPush(entry: Entry): void {
    void (async () => {
      if (entry.disposed) return;
      if (!(await desktopSupports(entry, MOBILE_CAPABILITY.pushNotifications))) return;
      const reg = await registerForPushTokenAsync();
      if (!reg || entry.disposed) return;
      await entry.client.request('notifications.registerPush', { token: reg.token, platform: reg.platform }).catch(() => undefined);
    })();
  }

  function scheduleReconnect(entry: Entry): void {
    if (entry.disposed || !foregrounded || entry.reconnectTimer) return;
    // Give up after a long unreachable streak. The state stays 'reconnecting' so
    // classifyConnection() reports "Can't reach desktop" (attempt >= cap) and the
    // UI surfaces Reconnect / Re-pair; forceReconnect() resets the counter.
    if (entry.attempt >= GIVE_UP_AFTER_ATTEMPTS) {
      pushLog(entry, 'error', 'Stopped reconnecting', `Unreachable after ${entry.attempt} attempts`);
      emit();
      return;
    }
    entry.attempt += 1;
    // Exponential backoff with jitter, capped, so a genuinely-down host isn't
    // hammered and multiple hosts don't reconnect in lockstep.
    const backoff = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** (entry.attempt - 1));
    const delay = backoff + Math.floor(Math.random() * 250);
    pushLog(entry, 'info', `Reconnect scheduled in ${Math.round(delay / 100) / 10}s`, `Attempt ${entry.attempt}`);
    entry.reconnectTimer = setTimeout(() => {
      entry.reconnectTimer = null;
      if (entry.disposed || !foregrounded) return;
      connectEntry(entry);
    }, delay);
  }

  // Single source of truth for "the socket just authenticated". Driven by the
  // client's onOpen event so it fires no matter who called connect() - the
  // manager's own connectEntry OR a screen's direct load()/pull-to-refresh.
  // Idempotent: re-entry for an already-connected entry only refreshes the
  // timestamp, so subscriptions aren't double-sent when connectEntry's promise
  // resolves right after onOpen.
  function markConnected(entry: Entry): void {
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
    pushLog(entry, 'success', 'Connected', elapsed != null ? `in ${Math.round(elapsed / 100) / 10}s` : undefined);
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
    emit();
  }

  function connectEntry(entry: Entry): void {
    // Reset transport state (nonce counter, listeners) before each (re)connect.
    entry.client.close();
    // Capabilities are per-connection; refetch after this (re)connect in case the
    // desktop was upgraded since we last saw it.
    entry.capabilities = null;
    // First attempt reads as 'connecting'; subsequent attempts as 'reconnecting'
    // so classifyConnection() can escalate the verdict as the streak grows.
    entry.state = entry.attempt > 0 ? 'reconnecting' : 'connecting';
    entry.connectStartedAt = Date.now();
    pushLog(entry, 'info', entry.attempt > 0 ? 'Reconnecting' : 'Opening connection', endpointDetail(entry));
    emit();
    entry.client
      .connect()
      .then(() => {
        // onOpen has usually already run markConnected; this is a safety net for
        // the case where the listener was somehow missed.
        markConnected(entry);
      })
      .catch((error: unknown) => {
        if (entry.disposed) return;
        // A rejected/revoked pairing is terminal: park in 'auth-failed' and do
        // NOT reconnect (retrying a dead token only churns). The UI shows a
        // re-pair banner; forceReconnect() is the only way out.
        if (error instanceof BraidAuthError) {
          entry.state = 'auth-failed';
          pushLog(entry, 'error', 'Pairing rejected', error.message);
          emit();
          return;
        }
        entry.state = 'reconnecting';
        pushLog(entry, 'warn', 'Connect failed', error instanceof Error ? error.message : String(error));
        emit();
        scheduleReconnect(entry);
      });
  }

  function makeEntry(host: PairedHost): Entry {
    const client = new BraidRpcClient(host);
    const entry: Entry = {
      host,
      client,
      state: 'disconnected',
      attempt: 0,
      offNotification: null,
      offClose: null,
      offOpen: null,
      reconnectTimer: null,
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
    startNotificationRouting(entry);
    // Sync state from any successful handshake, even screen-initiated ones, so a
    // direct load()/refresh that revives a parked socket clears the error verdict
    // (and its connection-log panel) instead of leaving it stuck.
    entry.offOpen = client.onOpen(() => markConnected(entry));
    entry.offClose = client.onClose((reason) => {
      if (entry.disposed) return;
      // Token revoked mid-session: the desktop closed with 4001. Park in
      // 'auth-failed' rather than reconnecting with the now-dead token.
      if (reason.authFailed) {
        entry.state = 'auth-failed';
        pushLog(entry, 'error', 'Pairing rejected', 'Desktop closed the connection (4001)');
        emit();
        return;
      }
      // Superseded (4000): a newer connection from this device took over (the
      // desktop allows one per device). Do NOT reconnect - reconnecting here is
      // what creates the infinite connect loop when a duplicate client briefly
      // exists. The newer connection is the live one.
      if (reason.superseded) {
        entry.state = 'disconnected';
        pushLog(entry, 'info', 'Connection superseded', 'Replaced by a newer connection (4000)');
        emit();
        return;
      }
      entry.state = 'reconnecting';
      pushLog(entry, 'warn', 'Connection dropped', 'Will attempt to reconnect');
      emit();
      scheduleReconnect(entry);
    });
    return entry;
  }

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
      entry = makeEntry(host);
      entries.set(host.id, entry);
      connectEntry(entry);
      emit();
    } else {
      entry.host = host;
    }
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
    pushLog(entry, 'info', 'Manual reconnect', endpointDetail(entry));
    connectEntry(entry);
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
        const off = entry.client.onOpen(() => {
          off();
          clearTimeout(timer);
          resolve();
        });
        const timer = setTimeout(() => {
          off();
          resolve();
        }, 4000);
        // Kick a connect unless one is already in flight (don't reset it).
        if (entry.state !== 'connecting') {
          entry.attempt = 0;
          connectEntry(entry);
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
    emit();
  };

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const subscribeActivity = (listener: (hostId: string) => void): (() => void) => {
    activityListeners.add(listener);
    return () => {
      activityListeners.delete(listener);
    };
  };

  const init = async (): Promise<void> => {
    try {
      const hosts = await loadHosts();
      for (const host of hosts) acquireHost(host);
    } catch {
      // Keychain can fail mid-unlock on cold start; screens re-acquire on mount.
    }
  };

  const onAppState = (state: AppStateStatus): void => {
    if (state === 'active') {
      if (foregrounded) return;
      foregrounded = true;
      for (const entry of entries.values()) {
        // Don't silently retry a rejected pairing on resume - it would churn a
        // dead token. The user must Reconnect / Re-pair explicitly.
        if (entry.state === 'auth-failed') continue;
        if (entry.state !== 'connected' && !entry.reconnectTimer) {
          entry.attempt = 0; // returning to foreground: reconnect promptly
          connectEntry(entry);
        }
      }
    } else if (state === 'background') {
      // iOS suspends sockets when backgrounded; close cleanly and reconnect on
      // return. 'inactive' is intentionally ignored (transient, e.g. the
      // notification shade) to avoid needless churn.
      foregrounded = false;
      for (const entry of entries.values()) {
        if (entry.reconnectTimer) {
          clearTimeout(entry.reconnectTimer);
          entry.reconnectTimer = null;
        }
        // Keep the notification routing listener and tracked subscriptions in
        // place; close() preserves them and resendSubscriptions() replays on
        // the next foreground connect. Preserve 'auth-failed' so it stays sticky
        // across a background/foreground cycle.
        if (entry.state !== 'auth-failed') entry.state = 'disconnected';
        entry.client.close();
      }
      emit();
    }
  };

  const disposeAll = (): void => {
    for (const id of [...entries.keys()]) dropHost(id);
  };

  return { acquireHost, getClient, getState, getReconnectAttempt, getLastConnectedAt, getConnectionLog, forceReconnect, dropHost, unregisterPush, syncPushRegistration, subscribe, subscribeActivity, init, onAppState, disposeAll };
}

const Ctx = createContext<ClientManager | null>(null);

export function ClientManagerProvider({ children }: { children: ReactNode }) {
  // Lazy `useState` initializer creates the manager exactly once and keeps a
  // stable reference, without reading/writing a ref during render.
  const [manager] = useState(createManager);

  useEffect(() => {
    void manager.init();
    const sub = AppState.addEventListener('change', manager.onAppState);
    return () => {
      sub.remove();
      manager.disposeAll();
    };
  }, [manager]);

  const value = useMemo<ClientManager>(
    () => ({
      acquireHost: manager.acquireHost,
      getClient: manager.getClient,
      getState: manager.getState,
      getReconnectAttempt: manager.getReconnectAttempt,
      getLastConnectedAt: manager.getLastConnectedAt,
      getConnectionLog: manager.getConnectionLog,
      forceReconnect: manager.forceReconnect,
      dropHost: manager.dropHost,
      unregisterPush: manager.unregisterPush,
      syncPushRegistration: manager.syncPushRegistration,
      subscribe: manager.subscribe,
      subscribeActivity: manager.subscribeActivity,
    }),
    [manager],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useClientManager(): ClientManager {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useClientManager must be used inside <ClientManagerProvider>');
  return ctx;
}
