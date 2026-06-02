import * as Device from 'expo-device';

import { decodeJsonBase64 } from './encoding';
import { decryptBinary, decryptJson, deriveSharedKey, encryptJson, fromBase64, generateKeyPair, toBase64 } from './e2ee';
import { decodeTerminalFrame } from './terminal-frame';
import type { JsonRpcResponse, PairedHost, PairingOffer, RpcNotification } from './types';

type AuthenticatedMessage = { type: 'e2ee_authenticated'; deviceId: string; instanceName: string; deviceToken?: string };
type ReadyMessage = { type: 'e2ee_ready'; serverEphemeralPublicKey: string };
type HandshakeMode = 'secure' | 'legacy';
const REQUEST_TIMEOUT_MS = 12_000;
// The desktop closes the socket with this code (mobileServer.ts) when the device
// token is missing/invalid/revoked or the encrypted auth fails. It is terminal:
// retrying with the same rejected token only churns, so the manager surfaces a
// re-pair affordance instead of reconnecting. See `BraidAuthError`.
const AUTH_CLOSE_CODE = 4001;

/** Raised when the desktop rejects this device's pairing (close code 4001). */
export class BraidAuthError extends Error {
  constructor(message = 'Pairing rejected by desktop') {
    super(message);
    this.name = 'BraidAuthError';
  }
}

/** True for a WebSocket close event that signals a terminal auth rejection. */
function isAuthCloseEvent(event: unknown): boolean {
  return (event as { code?: number } | undefined)?.code === AUTH_CLOSE_CODE;
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
  private sendCounter = 0;
  private receiveCounter = 0;
  private connectPromise: Promise<{ deviceId: string; instanceName: string }> | null = null;
  private nextId = 1;
  private queue: Promise<unknown> = Promise.resolve();
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private notificationListeners = new Set<(notification: RpcNotification) => void>();
  private closeListeners = new Set<(reason: { authFailed: boolean }) => void>();
  private openListeners = new Set<() => void>();
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

  private shouldRetryLegacyHello(error: unknown): boolean {
    return error instanceof BraidAuthError && this.host.endpoint.startsWith('ws://');
  }

  private async connectWithHandshake(mode: HandshakeMode): Promise<{ deviceId: string; instanceName: string }> {
    this.sharedKey = null;
    this.sendCounter = 0;
    this.receiveCounter = 0;
    console.log('[BraidMobile] rpc.connect.start', { endpoint: this.host.endpoint, hostId: this.host.id, mode });
    const ws = new WebSocket(this.host.endpoint);
    // Deliver binary terminal-output frames (protocol v3) as ArrayBuffers
    // rather than the RN default Blob, so handleRpcMessage can decode them
    // synchronously in arrival order (Blobs would force an async read and
    // desync the lockstep nonce counter against interleaved text frames).
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    const ephemeral = generateKeyPair();

    const handshakePromise = new Promise<{ deviceId: string; instanceName: string }>((resolve, reject) => {
      let handshakeKey: Uint8Array | null = null;
      let handshakeSendCounter = 0;
      let handshakeReceiveCounter = 0;
      let settled = false;

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
        this.sendCounter = 0;
        this.receiveCounter = 0;
        reject(error);
      };

      const cleanup = () => {
        ws.removeEventListener('open', onOpen);
        ws.removeEventListener('message', onHandshakeMessage);
        ws.removeEventListener('error', onError);
        ws.removeEventListener('close', onClose);
      };

      const onOpen = () => {
        if (this.ws !== ws) return;
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
            const payload = encryptJson({
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
            }, handshakeKey, handshakeSendCounter, false);
            handshakeSendCounter += 1;
            ws.send(payload);
            return;
          }

          const auth = decryptJson<AuthenticatedMessage>(data, handshakeKey, handshakeReceiveCounter, true);
          handshakeReceiveCounter += 1;
          if (auth.type !== 'e2ee_authenticated') throw new Error('Authentication failed');
          settled = true;
          cleanup();
          ws.addEventListener('message', this.handleRpcMessage);
          ws.addEventListener('close', this.rejectPending);
          this.sharedKey = handshakeKey;
          this.sendCounter = handshakeSendCounter;
          this.receiveCounter = handshakeReceiveCounter;
          if (auth.deviceToken) this.host.token = auth.deviceToken;
          this.host.id = auth.deviceId;
          this.host.instanceName = auth.instanceName;
          this.host.lastConnectedAt = Date.now();
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
  onClose(listener: (reason: { authFailed: boolean }) => void): () => void {
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

  private async sendRequest<T>(method: string, params: Record<string, unknown>): Promise<T> {
    await this.connect();
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error('Not connected to Braid desktop');
    const id = this.nextId++;
    const payload = this.encrypt({ jsonrpc: '2.0', id, method, params }, false);
    if (VERBOSE_RPC_LOGS) console.log('[BraidMobile] rpc.request.send', { id, method, params });
    ws.send(payload);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        reject(new Error(`Timed out waiting for ${method}`));
      }, REQUEST_TIMEOUT_MS);
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
    this.pending.clear();
    this.sendCounter = 0;
    this.receiveCounter = 0;
  }

  private encrypt(data: unknown, senderIsServer: boolean): string {
    if (!this.sharedKey) throw new Error('Encryption session is not ready');
    const payload = encryptJson(data, this.sharedKey, this.sendCounter, senderIsServer);
    this.sendCounter += 1;
    return payload;
  }

  private decrypt<T>(payload: string, senderIsServer: boolean): T {
    if (!this.sharedKey) throw new Error('Encryption session is not ready');
    const data = decryptJson<T>(payload, this.sharedKey, this.receiveCounter, senderIsServer);
    this.receiveCounter += 1;
    return data;
  }

  private handleRpcMessage = (event: WebSocketMessageEvent) => {
    // Binary frames carry raw PTY output (protocol v3). They share the session's
    // receive-counter sequence with text frames and arrive in order on the same
    // socket, so decoding them here keeps the counter aligned.
    if (typeof event.data !== 'string') {
      this.handleBinaryMessage(event.data as ArrayBuffer);
      return;
    }
    try {
      const response = this.decrypt<JsonRpcResponse | RpcNotification>(String(event.data), true);
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
    } catch (error) {
      console.error('[BraidMobile] rpc.message.error', {
        error: error instanceof Error ? error.message : String(error),
        sendCounter: this.sendCounter,
        receiveCounter: this.receiveCounter,
        pendingIds: [...this.pending.keys()],
      });
      for (const pending of this.pending.values()) {
        pending.reject(error instanceof Error ? error : new Error(String(error)));
      }
      this.pending.clear();
    }
  };

  private handleBinaryMessage(raw: ArrayBuffer) {
    try {
      if (!this.sharedKey) return;
      const plaintext = decryptBinary(new Uint8Array(raw), this.sharedKey, this.receiveCounter, true);
      // Only advance the counter once decryption succeeds, matching the text
      // path (decryptJson throws before its caller increments) so a failure
      // doesn't silently desync the stream.
      this.receiveCounter += 1;
      const frame = decodeTerminalFrame(plaintext);
      if (!frame) return;
      // Re-emit as the same terminal.data notification the JSON channel
      // produces, so screen-side routing is unchanged.
      const notification: RpcNotification = {
        jsonrpc: '2.0',
        method: 'terminal.data',
        params: { ptyId: frame.ptyId, data: frame.data },
      };
      for (const listener of this.notificationListeners) listener(notification);
    } catch (error) {
      // A binary decrypt failure means the nonce counter has desynced and the
      // session is unrecoverable; tear down pending work as the text path does.
      console.error('[BraidMobile] rpc.binary.error', {
        error: error instanceof Error ? error.message : String(error),
        receiveCounter: this.receiveCounter,
      });
      for (const pending of this.pending.values()) {
        pending.reject(error instanceof Error ? error : new Error(String(error)));
      }
      this.pending.clear();
    }
  }

  private rejectPending = (event?: WebSocketCloseEvent) => {
    const authFailed = isAuthCloseEvent(event);
    const message = authFailed ? 'Pairing rejected by desktop' : 'Connection closed';
    for (const pending of this.pending.values()) pending.reject(authFailed ? new BraidAuthError(message) : new Error(message));
    this.pending.clear();
    for (const listener of this.closeListeners) listener({ authFailed });
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
