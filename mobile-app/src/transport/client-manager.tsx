// App-level shared connection manager. Braid's desktop closes any existing
// connection from the same device on a new auth, so we cannot open one socket
// per screen plus a separate one for notifications - everything must ride a
// single shared BraidRpcClient per host. This provider owns that client's
// lifecycle: it connects lazily, keeps the socket alive while the app is
// foregrounded, subscribes to desktop notifications, and reconnects on drop.
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { loadHosts } from '@/transport/host-store';
import { BraidRpcClient } from '@/transport/rpc-client';
import type { PairedHost, RpcNotification } from '@/transport/types';
import { scheduleDesktopNotification } from '@/notifications/mobile-notifications';
import type { DesktopNotificationParams } from '@/notifications/notification-routing';

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

export type HostConnectionState = 'disconnected' | 'connecting' | 'connected';

interface Entry {
  host: PairedHost;
  client: BraidRpcClient;
  state: HostConnectionState;
  /** Consecutive failed/dropped connect attempts; drives reconnect backoff. */
  attempt: number;
  notifSubId: string | null;
  offNotification: (() => void) | null;
  offClose: (() => void) | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  disposed: boolean;
}

export interface ClientManager {
  /** Get-or-create the shared client for a host and keep it alive. */
  acquireHost: (host: PairedHost) => BraidRpcClient;
  getClient: (hostId: string) => BraidRpcClient | null;
  dropHost: (hostId: string) => void;
  /** Current connection state for a host (for UI status). */
  getState: (hostId: string) => HostConnectionState;
  /** Consecutive failed reconnect attempts (0 when connected/idle). */
  getReconnectAttempt: (hostId: string) => number;
  /** Subscribe to connection-state changes (for UI re-renders). */
  subscribe: (listener: () => void) => () => void;
}

function createManager(): ClientManager & {
  init: () => Promise<void>;
  onAppState: (state: AppStateStatus) => void;
  disposeAll: () => void;
} {
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  let foregrounded = true;

  const emit = () => {
    for (const listener of listeners) listener();
  };

  function startNotifications(entry: Entry): void {
    entry.offNotification = entry.client.onNotification((message: RpcNotification) => {
      if (message.method !== 'notification') return;
      void scheduleDesktopNotification(message.params as DesktopNotificationParams, entry.host.id);
    });
    entry.client
      .subscribe('notifications.subscribe')
      .then((id) => {
        entry.notifSubId = id;
      })
      .catch(() => {
        // Retried on the next reconnect.
      });
  }

  function teardownNotifications(entry: Entry): void {
    entry.offNotification?.();
    entry.offNotification = null;
    entry.notifSubId = null;
  }

  function scheduleReconnect(entry: Entry): void {
    if (entry.disposed || !foregrounded || entry.reconnectTimer) return;
    entry.attempt += 1;
    // Exponential backoff with jitter, capped, so a genuinely-down host isn't
    // hammered and multiple hosts don't reconnect in lockstep.
    const backoff = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** (entry.attempt - 1));
    const delay = backoff + Math.floor(Math.random() * 250);
    entry.reconnectTimer = setTimeout(() => {
      entry.reconnectTimer = null;
      if (entry.disposed || !foregrounded) return;
      connectEntry(entry);
    }, delay);
  }

  function connectEntry(entry: Entry): void {
    // Reset transport state (nonce counter, listeners) before each (re)connect.
    entry.client.close();
    entry.state = 'connecting';
    emit();
    entry.client
      .connect()
      .then(() => {
        if (entry.disposed) return;
        entry.state = 'connected';
        entry.attempt = 0;
        startNotifications(entry);
        emit();
      })
      .catch(() => {
        if (entry.disposed) return;
        entry.state = 'disconnected';
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
      notifSubId: null,
      offNotification: null,
      offClose: null,
      reconnectTimer: null,
      disposed: false,
    };
    entry.offClose = client.onClose(() => {
      if (entry.disposed) return;
      entry.state = 'disconnected';
      teardownNotifications(entry);
      emit();
      scheduleReconnect(entry);
    });
    return entry;
  }

  const acquireHost = (host: PairedHost): BraidRpcClient => {
    let entry = entries.get(host.id);
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

  const dropHost = (hostId: string): void => {
    const entry = entries.get(hostId);
    if (!entry) return;
    entry.disposed = true;
    if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer);
    teardownNotifications(entry);
    entry.offClose?.();
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
        teardownNotifications(entry);
        entry.state = 'disconnected';
        entry.client.close();
      }
      emit();
    }
  };

  const disposeAll = (): void => {
    for (const id of [...entries.keys()]) dropHost(id);
  };

  return { acquireHost, getClient, getState, getReconnectAttempt, dropHost, subscribe, init, onAppState, disposeAll };
}

const Ctx = createContext<ClientManager | null>(null);

export function ClientManagerProvider({ children }: { children: ReactNode }) {
  const ref = useRef<ReturnType<typeof createManager> | null>(null);
  if (!ref.current) ref.current = createManager();
  const manager = ref.current;

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
      dropHost: manager.dropHost,
      subscribe: manager.subscribe,
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
