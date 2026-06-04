import { createManager } from '../client-manager';
import type { BraidRpcClient } from '../rpc-client';
import type { PairedHost } from '../types';

// Stub the notifications module so the manager doesn't pull in expo-notifications
// (and its Expo Go warning) under the node test environment. babel-jest hoists
// jest.mock above the imports regardless of source position.
jest.mock('@/notifications/mobile-notifications', () => ({
  registerForPushTokenAsync: jest.fn().mockResolvedValue(null),
  scheduleDesktopNotification: jest.fn(),
}));

// These suites pin the reconnect/liveness contract. The manager is driven
// through injected fake clients so we can simulate the iOS failure modes - a
// socket the OS kills silently, a dead heartbeat, a rejected pairing - without a
// real WebSocket. The headline behavior: foreground resume throws away the old
// client and builds a fresh one ("kill and reset"), the only thing that
// reliably recovered a socket wedged across a suspension.

const HOST: PairedHost = {
  id: 'host-1',
  endpoint: 'ws://10.0.0.5:8080',
  token: 'tok',
  serverPublicKey: 'spk',
  deviceName: 'Test Phone',
  devicePublicKey: 'dpk',
  deviceSecretKey: 'dsk',
  pairedAt: 0,
};

/** Minimal controllable stand-in for BraidRpcClient. */
class FakeClient {
  open = false;
  connectCount = 0;
  closeCount = 0;
  /** How the next connect() resolves: succeed, fail, or hang forever. */
  connectMode: 'resolve' | 'reject' | 'hang' = 'resolve';
  /** Whether ping() resolves (live) or rejects (dead socket). */
  pingMode: 'resolve' | 'reject' = 'resolve';

  private openCbs = new Set<() => void>();
  private closeCbs = new Set<(r: { authFailed: boolean; superseded: boolean }) => void>();
  private notifCbs = new Set<(n: unknown) => void>();

  async connect(): Promise<{ deviceId: string; instanceName: string }> {
    this.connectCount += 1;
    if (this.connectMode === 'hang') return new Promise(() => {}); // never settles
    if (this.connectMode === 'reject') throw new Error('connect failed');
    this.open = true;
    for (const cb of this.openCbs) cb(); // the real client fires onOpen on auth
    return { deviceId: HOST.id, instanceName: 'Braid' };
  }

  close(): void {
    this.closeCount += 1;
    this.open = false;
  }

  isOpen(): boolean {
    return this.open;
  }

  async ping(): Promise<void> {
    if (this.pingMode === 'reject') throw new Error('ping timeout');
  }

  async request<T>(method: string): Promise<T> {
    if (method === 'status.get') return { capabilities: [] } as T;
    return {} as T;
  }

  async subscribe(): Promise<string> {
    return 'sub-1';
  }

  /** Simulate the desktop rejecting this device's pairing (close code 4001). */
  failAuth(): void {
    this.open = false;
    for (const cb of this.closeCbs) cb({ authFailed: true, superseded: false });
  }

  onOpen(cb: () => void): () => void {
    this.openCbs.add(cb);
    return () => this.openCbs.delete(cb);
  }

  onClose(cb: (r: { authFailed: boolean; superseded: boolean }) => void): () => void {
    this.closeCbs.add(cb);
    return () => this.closeCbs.delete(cb);
  }

  onNotification(cb: (n: unknown) => void): () => void {
    this.notifCbs.add(cb);
    return () => this.notifCbs.delete(cb);
  }

  resendSubscriptions(): void {}
  clearSubscriptions(): void {}
}

// createClient hands out a fresh fake each call, so a rebuild produces a new
// instance we can distinguish from the old one.
function setup() {
  const clients: FakeClient[] = [];
  const manager = createManager({
    createClient: () => {
      const c = new FakeClient();
      clients.push(c);
      return c as unknown as BraidRpcClient;
    },
  });
  const latest = () => clients[clients.length - 1];
  return { manager, clients, latest };
}

// Drain several microtask checkpoints so a connect().then().catch() chain (and
// any scheduleReconnect it triggers) fully settles before assertions.
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('client-manager reconnect/liveness', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('connects on acquire and reports connected', async () => {
    const { manager, clients, latest } = setup();
    manager.acquireHost(HOST);
    await flush();
    expect(clients.length).toBe(1);
    expect(latest().connectCount).toBe(1);
    expect(manager.getState(HOST.id)).toBe('connected');
    manager.disposeAll();
  });

  it('rebuilds a fresh client on foreground resume (kill and reset)', async () => {
    const { manager, clients, latest } = setup();
    manager.acquireHost(HOST);
    await flush();
    const first = latest();
    expect(manager.getState(HOST.id)).toBe('connected');

    // Resume: don't trust the old socket - throw it away and build a new client.
    manager.onAppState('active');
    await flush();

    expect(clients.length).toBe(2); // a brand-new client was created
    expect(latest()).not.toBe(first);
    expect(first.closeCount).toBeGreaterThan(0); // the old client was torn down
    expect(latest().isOpen()).toBe(true);
    expect(manager.getState(HOST.id)).toBe('connected');
    manager.disposeAll();
  });

  it('reconnects the same client when the heartbeat probe fails', async () => {
    const { manager, clients, latest } = setup();
    manager.acquireHost(HOST);
    await flush();
    manager.onAppState('active'); // arms the heartbeat (and rebuilds once)
    await flush();
    const c = latest();
    const beforeConnects = c.connectCount;
    const beforeClients = clients.length;

    // Socket goes dead; the next heartbeat ping rejects.
    c.pingMode = 'reject';
    await jest.advanceTimersByTimeAsync(20_000); // one heartbeat interval
    c.pingMode = 'resolve';
    await flush();

    // A foreground blip reconnects the SAME client (no rebuild) and recovers.
    expect(latest()).toBe(c);
    expect(clients.length).toBe(beforeClients);
    expect(c.connectCount).toBeGreaterThan(beforeConnects);
    expect(manager.getState(HOST.id)).toBe('connected');
    manager.disposeAll();
  });

  it('closes the socket on background and stops probing', async () => {
    const { manager, clients, latest } = setup();
    manager.acquireHost(HOST);
    await flush();
    manager.onAppState('active'); // arm heartbeat (rebuilds once)
    await flush();
    const c = latest();

    manager.onAppState('background');
    await flush();
    expect(c.isOpen()).toBe(false);
    expect(manager.getState(HOST.id)).toBe('disconnected');

    // Heartbeat stopped + backgrounded: advancing time must not probe/reconnect/rebuild.
    const connectsAfter = c.connectCount;
    const clientsAfter = clients.length;
    await jest.advanceTimersByTimeAsync(60_000);
    expect(c.connectCount).toBe(connectsAfter);
    expect(clients.length).toBe(clientsAfter);
    manager.disposeAll();
  });

  it('does not rebuild or reconnect a rejected pairing on resume', async () => {
    const { manager, clients, latest } = setup();
    manager.acquireHost(HOST);
    await flush();
    expect(manager.getState(HOST.id)).toBe('connected');

    // Desktop rejects the pairing mid-session (close code 4001): park 'auth-failed'.
    latest().failAuth();
    await flush();
    expect(manager.getState(HOST.id)).toBe('auth-failed');
    const clientsLen = clients.length;

    // A background/foreground cycle must leave it parked - no fresh client, no
    // connect. Only forceReconnect clears it.
    manager.onAppState('background');
    await flush();
    manager.onAppState('active');
    await flush();
    expect(manager.getState(HOST.id)).toBe('auth-failed');
    expect(clients.length).toBe(clientsLen);
    manager.disposeAll();
  });
});
