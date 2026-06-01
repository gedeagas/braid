import type { PairedHost } from './types';

export interface BonjourHost {
  id: string;
  name: string;
  endpoint: string;
  instanceId?: string;
  protocolVersion?: number;
}

type ZeroconfService = {
  name?: string;
  host?: string;
  port?: number;
  addresses?: string[];
  txt?: Record<string, unknown>;
}

type ZeroconfBrowser = {
  scan: (type?: string, protocol?: string, domain?: string) => void;
  stop: () => void;
  removeDeviceListeners?: () => void;
  on: (event: string, listener: (service: ZeroconfService | Error) => void) => void;
}

function serviceEndpoint(service: ZeroconfService): string | null {
  const port = service.port;
  if (!port) return null;
  const address = service.addresses?.find((item) => /^\d+\.\d+\.\d+\.\d+$/.test(item)) ?? service.host;
  if (!address) return null;
  return `ws://${address.replace(/\.local$/i, '')}:${port}`;
}

function serviceInstanceId(service: ZeroconfService): string | undefined {
  const value = service.txt?.instanceId;
  return typeof value === 'string' && value ? value : undefined;
}

function serviceProtocolVersion(service: ZeroconfService): number | undefined {
  const value = service.txt?.protocolVersion;
  const parsed = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function matchesDiscoveredHost(host: PairedHost, discovered: BonjourHost): boolean {
  return Boolean(discovered.instanceId && host.serverPublicKey === discovered.instanceId);
}

export function mergeDiscoveredEndpoint(host: PairedHost, discovered: BonjourHost): PairedHost {
  if (!matchesDiscoveredHost(host, discovered) || host.endpoint === discovered.endpoint) return host;
  return { ...host, endpoint: discovered.endpoint, instanceName: discovered.name };
}

export async function startBonjourBrowser(
  onHost: (host: BonjourHost) => void,
  onError?: (message: string) => void
): Promise<() => void> {
  let stopped = false;
  try {
    const mod = await import('react-native-zeroconf');
    if (stopped) return () => undefined;
    const Zeroconf = mod.default ?? mod;
    const browser = new Zeroconf() as ZeroconfBrowser;

    browser.on('resolved', (raw) => {
      const service = raw as ZeroconfService;
      const endpoint = serviceEndpoint(service);
      if (!endpoint) return;
      onHost({
        id: serviceInstanceId(service) ?? endpoint,
        name: service.name?.replace(/^Braid - /, '') || service.txt?.machineName as string || 'Braid desktop',
        endpoint,
        instanceId: serviceInstanceId(service),
        protocolVersion: serviceProtocolVersion(service),
      });
    });
    browser.on('error', (raw) => {
      const message = raw instanceof Error ? raw.message : String(raw);
      onError?.(message);
    });
    browser.scan('braid', 'tcp', 'local.');

    return () => {
      stopped = true;
      try { browser.stop(); } catch {}
      try { browser.removeDeviceListeners?.(); } catch {}
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    onError?.(message);
    return () => { stopped = true; };
  }
}
