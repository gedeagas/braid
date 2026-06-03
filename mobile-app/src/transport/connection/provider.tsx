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
