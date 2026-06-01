import * as Device from 'expo-device';

import { decodeJsonBase64 } from './encoding';
import { decryptJson, deriveSharedKey, encryptJson, fromBase64, generateKeyPair, toBase64 } from './e2ee';
import type { JsonRpcResponse, PairedHost, PairingOffer, RpcNotification } from './types';

type AuthenticatedMessage = { type: 'e2ee_authenticated'; deviceId: string; instanceName: string; deviceToken?: string };
type ReadyMessage = { type: 'e2ee_ready'; serverEphemeralPublicKey: string };
const REQUEST_TIMEOUT_MS = 12_000;

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
  private closeListeners = new Set<() => void>();
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

    this.sharedKey = null;
    this.sendCounter = 0;
    this.receiveCounter = 0;
    console.log('[BraidMobile] rpc.connect.start', { endpoint: this.host.endpoint, hostId: this.host.id });
    const ws = new WebSocket(this.host.endpoint);
    this.ws = ws;

    const ephemeral = generateKeyPair();

    this.connectPromise = new Promise((resolve, reject) => {
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
        if (this.connectPromise) this.connectPromise = null;
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
        console.log('[BraidMobile] rpc.ws.open', { endpoint: this.host.endpoint });
        ws.send(JSON.stringify({
          type: 'e2ee_hello',
          ephemeralPublicKey: toBase64(ephemeral.publicKey),
          deviceToken: this.host.token,
        }));
      };

      const onError = () => {
        if (this.ws === ws) fail(new Error('WebSocket connection failed'));
      };
      const onClose = () => {
        if (!settled && this.ws === ws) fail(new Error('Desktop closed the connection'));
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
              deviceName: this.host.deviceName,
              devicePublicKey: this.host.devicePublicKey,
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
          this.connectPromise = null;
          console.log('[BraidMobile] rpc.authenticated', { deviceId: auth.deviceId, instanceName: auth.instanceName });
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
    return this.connectPromise;
  }

  async request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const run = () => this.sendRequest<T>(method, params);
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  onNotification(listener: (notification: RpcNotification) => void): () => void {
    this.notificationListeners.add(listener);
    return () => {
      this.notificationListeners.delete(listener);
    };
  }

  /**
   * Fires when an established connection drops unexpectedly (not on manual
   * close()). Lets the connection manager schedule a reconnect.
   */
  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }

  /**
   * Start a stream subscription. Returns a stable client-local handle (not the
   * server's subscription id) that survives reconnects - pass it to
   * unsubscribe(). The subscription is re-sent automatically after a reconnect
   * via resendSubscriptions(); notification routing is content-based (by
   * ptyId/method in onNotification), so the changing server id doesn't matter.
   */
  async subscribe(method: string, params: Record<string, unknown> = {}): Promise<string> {
    const localId = `lsub-${++this.subCounter}`;
    this.subscriptions.set(localId, { method, params, serverId: null });
    await this.sendSubscribe(localId);
    return localId;
  }

  private async sendSubscribe(localId: string): Promise<void> {
    const entry = this.subscriptions.get(localId);
    if (!entry) return;
    const result = await this.request<{ subscriptionId: string }>(entry.method, entry.params);
    // The handle may have been unsubscribed while the request was in flight.
    const current = this.subscriptions.get(localId);
    if (current) current.serverId = result.subscriptionId;
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
    console.log('[BraidMobile] rpc.request.send', { id, method, params });
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
        console.log('[BraidMobile] rpc.response.ok', { id: response.id });
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

  private rejectPending = () => {
    for (const pending of this.pending.values()) pending.reject(new Error('Connection closed'));
    this.pending.clear();
    for (const listener of this.closeListeners) listener();
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
