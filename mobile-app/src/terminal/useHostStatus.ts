import { useEffect, useState } from 'react';

import type { BraidRpcClient } from '@/transport/rpc-client';
import type { BraidStatus } from '@/transport/types';

/**
 * Fetches the paired desktop's `status.get` once per client so a screen can gate
 * capability-negotiated features (via `desktopSupports`). Returns null until the
 * first response lands, or if the host is disconnected. Kept intentionally small
 * - it does not poll; capabilities don't change within a connection.
 */
export function useHostStatus(client: BraidRpcClient | null): BraidStatus | null {
  const [status, setStatus] = useState<BraidStatus | null>(null);

  useEffect(() => {
    let active = true;
    async function run() {
      if (!client) {
        if (active) setStatus(null);
        return;
      }
      try {
        const next = await client.request<BraidStatus>('status.get');
        if (active) setStatus(next);
      } catch {
        if (active) setStatus(null);
      }
    }
    void run();
    return () => {
      active = false;
    };
  }, [client]);

  return status;
}
