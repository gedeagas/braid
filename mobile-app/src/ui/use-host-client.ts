import { useEffect, useMemo, useState } from 'react';

import { getHost } from '@/transport/host-store';
import { BraidRpcClient } from '@/transport/rpc-client';
import type { PairedHost } from '@/transport/types';

export function useHostClient(hostId?: string | string[]) {
  const id = Array.isArray(hostId) ? hostId[0] : hostId;
  const [host, setHost] = useState<PairedHost | null>(null);
  const [loadingHost, setLoadingHost] = useState(true);

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
    });
    return () => {
      active = false;
    };
  }, [id]);

  const client = useMemo(() => (host ? new BraidRpcClient(host) : null), [host]);

  useEffect(() => () => client?.close(), [client]);

  return { host, client, loadingHost };
}
