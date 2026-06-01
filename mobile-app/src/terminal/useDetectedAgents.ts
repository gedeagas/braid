import { useEffect, useState } from 'react';

import { AGENT_CATALOG, type AgentCatalogEntry } from './agentCatalog';
import type { BraidRpcClient } from '@/transport/rpc-client';

const BATCH_SIZE = 5;

export function useDetectedAgents(client: BraidRpcClient | null) {
  const [detected, setDetected] = useState<AgentCatalogEntry[]>([]);

  useEffect(() => {
    let active = true;

    async function run() {
      if (!client) {
        if (active) setDetected([]);
        return;
      }

      const found: AgentCatalogEntry[] = [];
      for (let i = 0; i < AGENT_CATALOG.length; i += BATCH_SIZE) {
        const batch = AGENT_CATALOG.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(
          batch.map(async (agent) => {
            try {
              const ok = await client.request<boolean>('shell.checkTool', { tool: agent.detectCmd });
              return ok ? agent : null;
            } catch {
              return null;
            }
          })
        );
        for (const entry of results) {
          if (entry) found.push(entry);
        }
      }

      if (active) setDetected(found);
    }

    void run();
    return () => {
      active = false;
    };
  }, [client]);

  return detected;
}
