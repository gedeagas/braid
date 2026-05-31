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
  private counter = 0;
  private nextId = 1;
  private queue: Promise<unknown> = Promise.resolve();
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private notificationListeners = new Set<(notification: RpcNotification) => void>();

  constructor(private host: PairedHost) {}

  async connect(): Promise<{ deviceId: string; instanceName: string }> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return { deviceId: this.host.id, instanceName: this.host.instanceName ?? 'Braid' };
    }

    const ws = new WebSocket(this.host.endpoint);
    this.ws = ws;

    const ephemeral = generateKeyPair();

    return new Promise((resolve, reject) => {
      const fail = (error: Error) => {
        cleanup();
        try {
          ws.close();
        } catch {}
        reject(error);
      };

      const cleanup = () => {
        ws.removeEventListener('open', onOpen);
        ws.removeEventListener('message', onHandshakeMessage);
        ws.removeEventListener('error', onError);
        ws.removeEventListener('close', onClose);
      };

      const onOpen = () => {
        ws.send(JSON.stringify({
          type: 'e2ee_hello',
          ephemeralPublicKey: toBase64(ephemeral.publicKey),
          deviceToken: this.host.token,
        }));
      };

      const onError = () => fail(new Error('WebSocket connection failed'));
      const onClose = () => fail(new Error('Desktop closed the connection'));

      const onHandshakeMessage = (event: WebSocketMessageEvent) => {
        try {
          const data = String(event.data);
          if (!this.sharedKey) {
            const ready = JSON.parse(data) as ReadyMessage;
            if (ready.type !== 'e2ee_ready') throw new Error('Unexpected handshake response');
            this.sharedKey = deriveSharedKey(ephemeral.secretKey, fromBase64(ready.serverEphemeralPublicKey));
            ws.send(this.encrypt({
              type: 'e2ee_auth',
              deviceName: this.host.deviceName,
              devicePublicKey: this.host.devicePublicKey,
            }, false));
            return;
          }

          const auth = this.decrypt<AuthenticatedMessage>(data, true);
          if (auth.type !== 'e2ee_authenticated') throw new Error('Authentication failed');
          cleanup();
          ws.addEventListener('message', this.handleRpcMessage);
          ws.addEventListener('close', this.rejectPending);
          if (auth.deviceToken) this.host.token = auth.deviceToken;
          this.host.id = auth.deviceId;
          this.host.instanceName = auth.instanceName;
          this.host.lastConnectedAt = Date.now();
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

  async subscribe(method: string, params: Record<string, unknown> = {}): Promise<string> {
    const result = await this.request<{ subscriptionId: string }>(method, params);
    return result.subscriptionId;
  }

  private async sendRequest<T>(method: string, params: Record<string, unknown>): Promise<T> {
    await this.connect();
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error('Not connected to Braid desktop');
    const id = this.nextId++;
    const payload = this.encrypt({ jsonrpc: '2.0', id, method, params }, false);
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
    this.sharedKey = null;
    this.pending.clear();
    this.counter = 0;
  }

  private encrypt(data: unknown, senderIsServer: boolean): string {
    if (!this.sharedKey) throw new Error('Encryption session is not ready');
    const payload = encryptJson(data, this.sharedKey, this.counter, senderIsServer);
    this.counter += 1;
    return payload;
  }

  private decrypt<T>(payload: string, senderIsServer: boolean): T {
    if (!this.sharedKey) throw new Error('Encryption session is not ready');
    const data = decryptJson<T>(payload, this.sharedKey, this.counter, senderIsServer);
    this.counter += 1;
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
      if (response.error) pending.reject(new Error(response.error.message));
      else pending.resolve(response.result);
    } catch (error) {
      for (const pending of this.pending.values()) {
        pending.reject(error instanceof Error ? error : new Error(String(error)));
      }
      this.pending.clear();
    }
  };

  private rejectPending = () => {
    for (const pending of this.pending.values()) pending.reject(new Error('Connection closed'));
    this.pending.clear();
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
