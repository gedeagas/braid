import { useCallback, useEffect, useReducer, useState } from 'react';

import { getHost } from '@/transport/host-store';
import { useClientManager } from '@/transport/client-manager';
import { classifyConnection, type ConnectionVerdict } from '@/transport/connection-health';
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
  // Which id the resolved `host` corresponds to. `loadingHost` is derived from
  // it rather than set synchronously in the effect (which the hooks linter
  // flags): we're loading whenever there's an id we haven't resolved yet.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [, forceUpdate] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (!id) return;
    let active = true;
    getHost(id).then((next) => {
      if (!active) return;
      setHost(next);
      setLoadedFor(id);
      if (next) manager.acquireHost(next);
    });
    return () => {
      active = false;
    };
  }, [id, manager]);

  const loadingHost = id ? loadedFor !== id : false;

  // Re-render when the shared connection state changes so the screen can pick
  // up the client once it finishes connecting.
  useEffect(() => manager.subscribe(forceUpdate), [manager]);

  const client: BraidRpcClient | null = host ? manager.getClient(host.id) : null;
  const state = host ? manager.getState(host.id) : 'disconnected';
  const reconnectAttempts = host ? manager.getReconnectAttempt(host.id) : 0;
  const lastConnectedAt = host ? manager.getLastConnectedAt(host.id) : null;
  const verdict: ConnectionVerdict = classifyConnection({ state, reconnectAttempts, lastConnectedAt });

  const reconnect = useCallback(() => {
    if (host) manager.forceReconnect(host.id);
  }, [host, manager]);

  return { host, client, loadingHost, state, verdict, reconnectAttempts, lastConnectedAt, reconnect };
}
