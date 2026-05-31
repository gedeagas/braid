import * as SecureStore from 'expo-secure-store';

import type { PairedHost } from './types';

const STORE_KEY = 'braid.pairedHosts.v1';

export async function loadHosts(): Promise<PairedHost[]> {
  const raw = await SecureStore.getItemAsync(STORE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as PairedHost[];
  } catch {
    return [];
  }
}

export async function getHost(id: string): Promise<PairedHost | null> {
  return (await loadHosts()).find((host) => host.id === id) ?? null;
}

export async function saveHosts(hosts: PairedHost[]): Promise<void> {
  await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(hosts));
}

export async function upsertHost(host: PairedHost): Promise<PairedHost[]> {
  const hosts = await loadHosts();
  const next = [host, ...hosts.filter((item) => item.id !== host.id && item.endpoint !== host.endpoint)];
  await saveHosts(next);
  return next;
}

export async function removeHost(id: string): Promise<PairedHost[]> {
  const next = (await loadHosts()).filter((item) => item.id !== id);
  await saveHosts(next);
  return next;
}
