// React binding for the connection manager: a single instance per app, wired to
// the OS AppState lifecycle and exposed through context.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { createManager } from './manager';
import type { ClientManager } from './types';

const Ctx = createContext<ClientManager | null>(null);

export function ClientManagerProvider({ children }: { children: ReactNode }) {
  // Lazy `useState` initializer creates the manager exactly once and keeps a
  // stable reference, without reading/writing a ref during render.
  const [manager] = useState(createManager);

  useEffect(() => {
    void manager.init();
    const sub = AppState.addEventListener('change', manager.onAppState);
    // TODO(netinfo): reconnect on network change. Add a
    // `@react-native-community/netinfo` (or `expo-network`) listener here,
    // alongside the AppState one, and call `manager.onNetworkReconnect()` when
    // connectivity is regained (state.isConnected && state.isInternetReachable
    // flips false -> true, or the transport type changes wifi <-> cellular).
    // That catches a network swap while the app stays foregrounded - the
    // heartbeat already covers it within HEARTBEAT_INTERVAL_MS, this just makes
    // it instant. NOTE: NetInfo is a NATIVE module, so adding it requires a new
    // dev/standalone build - it canNOT ship over `eas update`. Left out for now
    // to keep this change OTA-deployable.
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
