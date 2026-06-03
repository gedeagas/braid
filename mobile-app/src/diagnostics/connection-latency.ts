import type { BraidRpcClient, ConnectionMetrics } from '@/transport/rpc-client';

export type LatencyVerdict = 'good' | 'fair' | 'poor' | 'unreachable';

export interface LatencyDiagnostic {
  verdict: LatencyVerdict;
  label: string;
  rttMs: number | null;
  connectMs: number | null;
  authMs: number | null;
  transport: 'lan' | 'ngrok' | 'unknown';
  testedAt: number;
  error: string | null;
}

interface PingResult {
  desktopReceivedAt: number;
  clientSentAt: number | null;
  transport?: 'lan' | 'ngrok';
}

export function classifyLatency(rttMs: number | null): LatencyVerdict {
  if (rttMs == null) return 'unreachable';
  if (rttMs < 150) return 'good';
  if (rttMs <= 350) return 'fair';
  return 'poor';
}

export function latencyLabel(verdict: LatencyVerdict): string {
  if (verdict === 'good') return 'Good';
  if (verdict === 'fair') return 'Fair';
  if (verdict === 'poor') return 'Poor';
  return 'Unreachable';
}

export function formatLatency(value: number | null): string {
  return value == null ? '-' : `${Math.round(value)} ms`;
}

function metricsFromClient(client: BraidRpcClient): ConnectionMetrics | null {
  return client.getLastConnectionMetrics();
}

export async function runLatencyDiagnostic(client: BraidRpcClient): Promise<LatencyDiagnostic> {
  try {
    await client.connect();
    const clientSentAt = Date.now();
    const result = await client.requestUnordered<PingResult>('diagnostics.ping', { clientSentAt });
    const finishedAt = Date.now();
    const rttMs = finishedAt - clientSentAt;
    const verdict = classifyLatency(rttMs);
    const metrics = metricsFromClient(client);
    return {
      verdict,
      label: latencyLabel(verdict),
      rttMs,
      connectMs: metrics?.connectMs ?? null,
      authMs: metrics?.authMs ?? null,
      transport: result.transport ?? 'unknown',
      testedAt: finishedAt,
      error: null,
    };
  } catch (error) {
    const metrics = metricsFromClient(client);
    return {
      verdict: 'unreachable',
      label: latencyLabel('unreachable'),
      rttMs: null,
      connectMs: metrics?.connectMs ?? null,
      authMs: metrics?.authMs ?? null,
      transport: 'unknown',
      testedAt: Date.now(),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
