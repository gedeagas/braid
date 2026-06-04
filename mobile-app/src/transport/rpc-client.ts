import * as Device from 'expo-device';

import { decodeJsonBase64 } from './encoding';
import { deriveSharedKey, fromBase64, generateKeyPair, openBytes, openJson, sealJson, toBase64 } from './e2ee';
import { decodeTerminalFrame } from './terminal-frame';
import type { JsonRpcResponse, PairedHost, PairingOffer, RpcNotification } from './types';

type AuthenticatedMessage = { type: 'e2ee_authenticated'; deviceId: string; instanceName: string; deviceToken?: string };
type ReadyMessage = { type: 'e2ee_ready'; serverEphemeralPublicKey: string };
type HandshakeMode = 'secure' | 'legacy';
export interface ConnectionMetrics {
  connectMs: number;
  authMs: number;
  totalMs: number;
  openedAt: number;
  authenticatedAt: number;
}
const REQUEST_TIMEOUT_MS = 12_000;
// Hard ceiling on the WebSocket open + E2EE handshake. Without it a socket that
// iOS hands back stalled after a long background (no open, no error, no close -
// the JS thread was frozen while the OS tore the TCP connection down) would leave
// connect() pending forever, parking the manager in 'connecting' with no retry.
// Bounding it guarantees connect() always settles, so connectEntry's catch fires
// and the reconnect backoff takes over. Generous enough to absorb a slow LAN
// handshake on a cold radio.
const CONNECT_TIMEOUT_MS = 15_000;
// Default per-heartbeat deadline. Shorter than REQUEST_TIMEOUT_MS so a half-open
// socket (TCP dead, but the OS never delivered a close) is detected in seconds
// rather than the 12s a normal RPC waits before giving up.
const PING_TIMEOUT_MS = 6_000;
// The desktop closes the socket with this code (mobileServer.ts) when the device
// token is missing/invalid/revoked or the encrypted auth fails. It is terminal:
// retrying with the same rejected token only churns, so the manager surfaces a
// re-pair affordance instead of reconnecting. See `BraidAuthError`.
const AUTH_CLOSE_CODE = 4001;
// The desktop closes the OLD socket with this code (mobileServer.ts: "Replaced
// by new connection") when a newer connection from the same device authenticates
// - it allows only one connection per device. This is NOT a dropped link: a
// newer socket is already live, so the evicted socket must NOT reconnect.
// Reconnecting here is what creates the infinite connect loop when two clients
// briefly exist for one device (e.g. on first pair, before the host id settles).
const SUPERSEDED_CLOSE_CODE = 4000;

/** Raised when the desktop rejects this device's pairing (close code 4001). */
export class BraidAuthError extends Error {
  constructor(message = 'Pairing rejected by desktop') {
    super(message);
    this.name = 'BraidAuthError';
  }
}

/**
 * Raised when a request gets no answer within its deadline. Distinct from a
 * normal RPC error response: a timeout means the link is dead (nothing came
 * back), whereas an error response proves the desktop is alive and answering.
 * The heartbeat relies on this distinction so an older desktop that lacks a
 * method (answering "method not found") isn't mistaken for a dead socket.
 */
export class RequestTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestTimeoutError';
  }
}

/** True for a WebSocket close event that signals a terminal auth rejection. */
function isAuthCloseEvent(event: unknown): boolean {
  return (event as { code?: number } | undefined)?.code === AUTH_CLOSE_CODE;
}

/** True when the desktop replaced this socket with a newer one (do not reconnect). */
function isSupersededCloseEvent(event: unknown): boolean {
  return (event as { code?: number } | undefined)?.code === SUPERSEDED_CLOSE_CODE;
}
// Per-message RPC tracing. Off by default: these fire on every request and
// response (i.e. every keystroke and every terminal.data ack), so logging them
// is pure hot-path overhead. Flip to true to debug the wire protocol.
const VERBOSE_RPC_LOGS = false;

export function parsePairingPayload(payload: string): PairingOffer {
  const trimmed = payload.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed) as PairingOffer;
  return decodeJsonBase64<PairingOffer>(trimmed);
}

export class BraidRpcClient {
  private ws: WebSocket | null = null;
  private sharedKey: Uint8Array | null = null;
  private connectPromise: Promise<{ deviceId: string; instanceName: string }> | null = null;
  private nextId = 1;
  private queue: Promise<unknown> = Promise.resolve();
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private notificationListeners = new Set<(notification: RpcNotification) => void>();
  private closeListeners = new Set<(reason: { authFailed: boolean; superseded: boolean }) => void>();
  private openListeners = new Set<() => void>();
  private lastConnectionMetrics: ConnectionMetrics | null = null;
  // Active stream subscriptions, tracked so they can be auto-replayed after a
  // reconnect (the desktop drops all subscriptions when the socket closes, and
  // assigns fresh server ids on re-subscribe). Keyed by a stable client-local
  // id so callers hold a handle that survives reconnects.
  private subscriptions = new Map<string, { method: string; params: Record<string, unknown>; serverId: string | null }>();
  private subCounter = 0;

  constructor(private host: PairedHost) {}

  async connect(): Promise<{ deviceId: string; instanceName: string }> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return { deviceId: this.host.id, instanceName: this.host.instanceName ?? 'Braid' };
    }
    // Coalesce concurrent connect() calls onto one handshake. With the shared
    // client, the connection manager and a screen's first request() can both
    // trigger connect at once; without this they would open duplicate sockets.
    if (this.connectPromise) return this.connectPromise;

    const connectPromise = this.connectWithHandshake('secure').catch((error) => {
      if (this.shouldRetryLegacyHello(error)) {
        console.warn('[BraidMobile] rpc.connect.legacyHelloFallback', { endpoint: this.host.endpoint });
        return this.connectWithHandshake('legacy');
      }
      throw error;
    });
    const finalPromise = connectPromise.finally(() => {
      if (this.connectPromise === finalPromise) this.connectPromise = null;
    });
    this.connectPromise = finalPromise;
    return this.connectPromise;
  }

  getLastConnectionMetrics(): ConnectionMetrics | null {
    return this.lastConnectionMetrics;
  }

  private shouldRetryLegacyHello(error: unknown): boolean {
    return error instanceof BraidAuthError && this.host.endpoint.startsWith('ws://');
  }

  private async connectWithHandshake(mode: HandshakeMode): Promise<{ deviceId: string; instanceName: string }> {
    this.sharedKey = null;
    console.log('[BraidMobile] rpc.connect.start', { endpoint: this.host.endpoint, hostId: this.host.id, mode });
    const connectStartedAt = Date.now();
    let openedAt: number | null = null;
    const ws = new WebSocket(this.host.endpoint);
    // Deliver binary terminal-output frames as ArrayBuffers rather than the RN
    // default Blob, so handleRpcMessage can decode them synchronously without an
    // async Blob read. Each frame self-describes its nonce, so ordering no longer
    // affects correctness - this is purely to keep decoding off the microtask queue.
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    const ephemeral = generateKeyPair();

    const handshakePromise = new Promise<{ deviceId: string; instanceName: string }>((resolve, reject) => {
      let handshakeKey: Uint8Array | null = null;
      let settled = false;
      // Bound the whole open+handshake. If it neither authenticates nor errors
      // within the deadline (a stalled socket after a long background), fail it
      // so connect() rejects and the manager schedules a reconnect.
      const timeout = setTimeout(() => fail(new Error('Connection timed out')), CONNECT_TIMEOUT_MS);

      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        console.error('[BraidMobile] rpc.connect.error', error.message);
        cleanup();
        try {
          ws.close();
        } catch {}
        if (this.ws === ws) this.ws = null;
        this.sharedKey = null;
        reject(error);
      };

      const cleanup = () => {
        clearTimeout(timeout);
        ws.removeEventListener('open', onOpen);
        ws.removeEventListener('message', onHandshakeMessage);
        ws.removeEventListener('error', onError);
        ws.removeEventListener('close', onClose);
      };

      const onOpen = () => {
        if (this.ws !== ws) return;
        openedAt = Date.now();
        console.log('[BraidMobile] rpc.ws.open', { endpoint: this.host.endpoint, mode });
        const hello: { type: 'e2ee_hello'; ephemeralPublicKey: string; deviceToken?: string } = {
          type: 'e2ee_hello',
          ephemeralPublicKey: toBase64(ephemeral.publicKey),
        };
        if (mode === 'legacy') hello.deviceToken = this.host.token;
        ws.send(JSON.stringify(hello));
      };

      const onError = () => {
        if (this.ws === ws) fail(new Error('WebSocket connection failed'));
      };
      const onClose = (event: WebSocketCloseEvent) => {
        if (settled || this.ws !== ws) return;
        // A 4001 close during the handshake means the desktop rejected this
        // device's token - terminal, so surface it as an auth error the manager
        // won't retry rather than a generic transient drop.
        if (isAuthCloseEvent(event)) {
          fail(new BraidAuthError(event?.reason || 'Pairing rejected by desktop'));
          return;
        }
        fail(new Error('Desktop closed the connection'));
      };

      const onHandshakeMessage = (event: WebSocketMessageEvent) => {
        if (this.ws !== ws) return;
        try {
          const data = String(event.data);
          if (!handshakeKey) {
            if (!data.trim().startsWith('{')) {
              console.error('[BraidMobile] rpc.handshake.nonJsonReady', {
                prefix: data.slice(0, 80),
                length: data.length,
              });
              throw new Error(`Unexpected plaintext handshake response: ${data.slice(0, 40)}`);
            }
            const ready = JSON.parse(data) as ReadyMessage;
            if (ready.type !== 'e2ee_ready') throw new Error('Unexpected handshake response');
            handshakeKey = deriveSharedKey(ephemeral.secretKey, fromBase64(ready.serverEphemeralPublicKey));
            console.log('[BraidMobile] rpc.e2ee.ready');
            const payload = sealJson({
              type: 'e2ee_auth',
              deviceToken: this.host.token,
              deviceName: this.host.deviceName,
              devicePublicKey: this.host.devicePublicKey,
              // Advertise client capabilities. The desktop ignores unknown keys
              // and falls back to legacy behaviour for any it doesn't implement,
              // so it is always safe to send these.
              //  - binaryTerminalData: we can decode the binary PTY output channel.
              //  - subscribeSnapshot: deliver the scrollback in the subscribe
              //    result so it can't race behind live output.
              capabilities: { binaryTerminalData: true, subscribeSnapshot: true },
            }, handshakeKey);
            ws.send(payload);
            return;
          }

          const auth = openJson<AuthenticatedMessage>(data, handshakeKey);
          if (!auth || auth.type !== 'e2ee_authenticated') throw new Error('Authentication failed');
          settled = true;
          cleanup();
          ws.addEventListener('message', this.handleRpcMessage);
          ws.addEventListener('close', this.rejectPending);
          this.sharedKey = handshakeKey;
          if (auth.deviceToken) this.host.token = auth.deviceToken;
          this.host.id = auth.deviceId;
          this.host.instanceName = auth.instanceName;
          this.host.lastConnectedAt = Date.now();
          const authenticatedAt = Date.now();
          this.lastConnectionMetrics = {
            connectMs: (openedAt ?? authenticatedAt) - connectStartedAt,
            authMs: authenticatedAt - (openedAt ?? connectStartedAt),
            totalMs: authenticatedAt - connectStartedAt,
            openedAt: openedAt ?? authenticatedAt,
            authenticatedAt,
          };
          console.log('[BraidMobile] rpc.authenticated', { deviceId: auth.deviceId, instanceName: auth.instanceName });
          // Notify listeners (the ClientManager) that a handshake completed -
          // regardless of who triggered connect(). A screen calling connect()
          // directly (load / pull-to-refresh) must still sync the manager's
          // state to 'connected', otherwise it stays stuck on a stale verdict.
          for (const listener of this.openListeners) listener();
          resolve({ deviceId: auth.deviceId, instanceName: auth.instanceName });
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)));
        }
      };

      ws.addEventListener('open', onOpen);
      ws.addEventListener('message', onHandshakeMessage);
      ws.addEventListener('error', onError);
      ws.addEventListener('close', onClose);
    });
    return handshakePromise;
  }

  async request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const run = () => this.sendRequest<T>(method, params);
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /**
   * Sends a request WITHOUT joining the serialized request queue. Responses are
   * still correlated by id, so concurrent in-flight requests are safe.
   *
   * Use ONLY for independent, order-insensitive background reads (e.g. PR
   * status). Routing a slow call through the serial `request()` queue causes
   * head-of-line blocking: a gh-CLI-backed lookup sitting ahead of an
   * interactive `terminal.create`/`terminal.subscribe` would starve the live
   * terminal until it resolves or times out. The desktop dispatches RPCs
   * concurrently, so bypassing the client queue keeps interactive RPCs snappy.
   */
  async requestUnordered<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return this.sendRequest<T>(method, params);
  }

  /**
   * True only when the underlying socket is actually OPEN. The manager checks
   * this on resume instead of trusting its cached connection state: iOS can kill
   * the TCP connection while the app is suspended without ever delivering a
   * `close` event, leaving a half-open socket the manager still believes is
   * 'connected'. Reading readyState is the only ground truth.
   */
  isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Round-trip liveness probe. Resolves when the desktop answers diagnostics.ping
   * within `timeoutMs`, rejects otherwise. Sent unordered so a slow interactive
   * RPC ahead of it in the queue can't delay the probe and trip a false-positive
   * "dead socket" verdict. The manager's heartbeat uses this to detect a half-open
   * socket that emitted no close event.
   */
  async ping(timeoutMs = PING_TIMEOUT_MS): Promise<void> {
    try {
      await this.sendRequest('diagnostics.ping', { clientSentAt: Date.now() }, timeoutMs);
    } catch (error) {
      // Only a timeout (no answer at all) means the socket is dead. Any RPC
      // error response - e.g. an older desktop that lacks diagnostics.ping and
      // replies "method not found" - proves the link is alive, so it is NOT a
      // heartbeat failure. Re-throw timeouts; swallow error responses.
      if (error instanceof RequestTimeoutError) throw error;
    }
  }

  onNotification(listener: (notification: RpcNotification) => void): () => void {
    this.notificationListeners.add(listener);
    return () => {
      this.notificationListeners.delete(listener);
    };
  }

  /**
   * Fires when an established connection drops unexpectedly (not on manual
   * close()). `reason.authFailed` is true when the desktop rejected the pairing
   * (close code 4001), letting the manager surface a re-pair affordance instead
   * of reconnecting; otherwise it schedules a normal reconnect.
   */
  onClose(listener: (reason: { authFailed: boolean; superseded: boolean }) => void): () => void {
    this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }

  /**
   * Fires whenever the E2EE handshake completes - including connect() calls a
   * screen makes directly (load / pull-to-refresh), not just the manager's own.
   * Lets the manager keep its connection state in sync with the live socket.
   */
  onOpen(listener: () => void): () => void {
    this.openListeners.add(listener);
    return () => {
      this.openListeners.delete(listener);
    };
  }

  /**
   * Start a stream subscription. Returns a stable client-local handle (not the
   * server's subscription id) that survives reconnects - pass it to
   * unsubscribe(). The subscription is re-sent automatically after a reconnect
   * via resendSubscriptions(); notification routing is content-based (by
   * ptyId/method in onNotification), so the changing server id doesn't matter.
   */
  async subscribe<R extends { subscriptionId: string } = { subscriptionId: string }>(
    method: string,
    params: Record<string, unknown> = {},
    // Invoked once with the *initial* subscribe result (e.g. to read a snapshot
    // the server returns inline). Deliberately NOT called on reconnect resends
    // (resendSubscriptions calls sendSubscribe directly), so a caller that
    // writes the snapshot to the terminal won't re-append it on every reconnect.
    onInitialResult?: (result: R) => void,
  ): Promise<string> {
    const localId = `lsub-${++this.subCounter}`;
    this.subscriptions.set(localId, { method, params, serverId: null });
    const result = await this.sendSubscribe<R>(localId);
    if (onInitialResult && result) onInitialResult(result);
    return localId;
  }

  private async sendSubscribe<T extends { subscriptionId: string } = { subscriptionId: string }>(
    localId: string,
  ): Promise<T | undefined> {
    const entry = this.subscriptions.get(localId);
    if (!entry) return undefined;
    const result = await this.request<T>(entry.method, entry.params);
    // The handle may have been unsubscribed while the request was in flight.
    const current = this.subscriptions.get(localId);
    if (current) current.serverId = result.subscriptionId;
    return result;
  }

  async unsubscribe(localId: string): Promise<void> {
    const entry = this.subscriptions.get(localId);
    this.subscriptions.delete(localId);
    if (!entry?.serverId) return;
    const unsubMethod = entry.method.replace(/\.subscribe$/, '.unsubscribe');
    await this.request(unsubMethod, { subscriptionId: entry.serverId }).catch(() => undefined);
  }

  /**
   * Re-send every tracked subscription. Called by the connection manager after
   * a reconnect so live streams (terminals, notifications) resume without each
   * screen having to detect the drop and re-subscribe itself.
   */
  resendSubscriptions(): void {
    for (const [localId, entry] of this.subscriptions) {
      entry.serverId = null;
      void this.sendSubscribe(localId).catch(() => undefined);
    }
  }

  /** Forget all tracked subscriptions (used when permanently dropping a host). */
  clearSubscriptions(): void {
    this.subscriptions.clear();
  }

  private async sendRequest<T>(method: string, params: Record<string, unknown>, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
    await this.connect();
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error('Not connected to Braid desktop');
    const id = this.nextId++;
    const payload = this.encrypt({ jsonrpc: '2.0', id, method, params });
    if (VERBOSE_RPC_LOGS) console.log('[BraidMobile] rpc.request.send', { id, method, params });
    ws.send(payload);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        reject(new RequestTimeoutError(`Timed out waiting for ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as T);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
  }

  close(): void {
    this.ws?.removeEventListener('message', this.handleRpcMessage);
    this.ws?.removeEventListener('close', this.rejectPending);
    this.ws?.close();
    this.ws = null;
    this.connectPromise = null;
    this.sharedKey = null;
    // Reject every in-flight request before clearing. We removed rejectPending
    // above so the socket's close event won't settle them, and a bare clear()
    // would strand each caller's promise forever (the request timeout fires its
    // callback, finds the id already gone, and returns early). A manual close
    // (backgrounding / reconnect) must settle callers so they can react.
    for (const pending of this.pending.values()) pending.reject(new Error('Connection closed'));
    this.pending.clear();
  }

  private encrypt(data: unknown): string {
    if (!this.sharedKey) throw new Error('Encryption session is not ready');
    return sealJson(data, this.sharedKey);
  }

  private handleRpcMessage = (event: WebSocketMessageEvent) => {
    // Binary frames carry raw PTY output. Each frame self-describes its nonce
    // (see e2ee.sealBytes), so it decodes independently of text frames - no
    // shared counter, no ordering dependency between the two channels.
    if (typeof event.data !== 'string') {
      this.handleBinaryMessage(event.data as ArrayBuffer);
      return;
    }
    if (!this.sharedKey) return;
    const response = openJson<JsonRpcResponse | RpcNotification>(String(event.data), this.sharedKey);
    if (!response) {
      // A single undecryptable text frame is isolated under the random-nonce
      // scheme: drop it and keep the session alive instead of tearing down.
      console.warn('[BraidMobile] rpc.message.dropped');
      return;
    }
    if ('method' in response && !('id' in response)) {
      for (const listener of this.notificationListeners) listener(response);
      return;
    }
    if ('method' in response) return;
    if (typeof response.id !== 'number') return;
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    if (response.error) {
      console.error('[BraidMobile] rpc.response.error', { id: response.id, error: response.error.message });
      pending.reject(new Error(response.error.message));
    } else {
      if (VERBOSE_RPC_LOGS) console.log('[BraidMobile] rpc.response.ok', { id: response.id });
      pending.resolve(response.result);
    }
  };

  private handleBinaryMessage(raw: ArrayBuffer) {
    if (!this.sharedKey) return;
    const plaintext = openBytes(new Uint8Array(raw), this.sharedKey);
    // A single bad binary frame is isolated (its own nonce travels with it), so
    // drop it and keep streaming rather than freezing the terminal.
    if (!plaintext) {
      console.warn('[BraidMobile] rpc.binary.dropped');
      return;
    }
    const frame = decodeTerminalFrame(plaintext);
    if (!frame) return;
    // Re-emit as the same terminal.data notification the JSON channel produces,
    // so screen-side routing is unchanged.
    const notification: RpcNotification = {
      jsonrpc: '2.0',
      method: 'terminal.data',
      params: { ptyId: frame.ptyId, data: frame.data },
    };
    for (const listener of this.notificationListeners) listener(notification);
  }

  private rejectPending = (event?: WebSocketCloseEvent) => {
    const authFailed = isAuthCloseEvent(event);
    const superseded = isSupersededCloseEvent(event);
    const message = authFailed ? 'Pairing rejected by desktop' : superseded ? 'Replaced by a newer connection' : 'Connection closed';
    for (const pending of this.pending.values()) pending.reject(authFailed ? new BraidAuthError(message) : new Error(message));
    this.pending.clear();
    for (const listener of this.closeListeners) listener({ authFailed, superseded });
  };
}

export function createHostFromOffer(offer: PairingOffer): PairedHost {
  const keyPair = generateKeyPair();
  const now = Date.now();
  const deviceName = Device.deviceName || 'Braid Mobile';
  return {
    id: `${offer.endpoint}-${offer.token.slice(0, 12)}`,
    endpoint: offer.endpoint,
    token: offer.token,
    serverPublicKey: offer.serverPublicKey,
    deviceName,
    devicePublicKey: toBase64(keyPair.publicKey),
    deviceSecretKey: toBase64(keyPair.secretKey),
    pairedAt: now,
  };
}
