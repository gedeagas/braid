import { useEffect, useReducer, useState } from 'react';

import { getHost } from '@/transport/host-store';
import { useClientManager } from '@/transport/client-manager';
import { BraidRpcClient } from '@/transport/rpc-client';
import type { PairedHost } from '@/transport/types';

/**
 * Resolves a paired host and returns the shared, app-level RPC client for it.
 * The client's lifecycle is owned by the ClientManager - screens never open or
 * close their own sockets (the desktop allows only one connection per device).
 */
export function useHostClient(hostId?: string | string[]) {
  const id = Array.isArray(hostId) ? hostId[0] : hostId;
  const manager = useClientManager();
  const [host, setHost] = useState<PairedHost | null>(null);
  const [loadingHost, setLoadingHost] = useState(true);
  const [, forceUpdate] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    let active = true;
    if (!id) {
      setLoadingHost(false);
      return;
    }
    getHost(id).then((next) => {
      if (!active) return;
      setHost(next);
      setLoadingHost(false);
      if (next) manager.acquireHost(next);
    });
    return () => {
      active = false;
    };
  }, [id, manager]);

  // Re-render when the shared connection state changes so the screen can pick
  // up the client once it finishes connecting.
  useEffect(() => manager.subscribe(forceUpdate), [manager]);

  const client: BraidRpcClient | null = host ? manager.getClient(host.id) : null;
  const state = host ? manager.getState(host.id) : 'disconnected';

  return { host, client, loadingHost, state };
}
