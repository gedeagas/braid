import { networkInterfaces } from 'node:os';
import { WebSocketServer } from 'ws';
import nacl from 'tweetnacl';

const port = Number(process.env.BRAID_MOCK_PORT ?? 6839);
const token = 'mock-device-token';
const serverKeyPair = nacl.box.keyPair();

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function fromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'));
}

function nonce(counter: number, senderIsServer: boolean): Uint8Array {
  const value = counter * 2 + (senderIsServer ? 0 : 1);
  const data = new Uint8Array(nacl.box.nonceLength);
  const view = new DataView(data.buffer);
  view.setUint32(16, Math.floor(value / 0x100000000));
  view.setUint32(20, value >>> 0);
  return data;
}

function encrypt(data: unknown, sharedKey: Uint8Array, counter: number): string {
  const plain = new TextEncoder().encode(JSON.stringify(data));
  return toBase64(nacl.box.after(plain, nonce(counter, true), sharedKey));
}

function decrypt<T>(payload: string, sharedKey: Uint8Array, counter: number): T {
  const opened = nacl.box.open.after(fromBase64(payload), nonce(counter, false), sharedKey);
  if (!opened) throw new Error('decrypt failed');
  return JSON.parse(new TextDecoder().decode(opened)) as T;
}

function lanIp(): string {
  for (const group of Object.values(networkInterfaces())) {
    for (const iface of group ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

const projects = [{
  id: 'mock-project',
  name: 'Braid Mock',
  path: '/mock/braid',
  worktrees: [
    { id: 'wt-main', path: '/mock/braid', branch: 'main', isMain: true },
    { id: 'wt-mobile', path: '/mock/braid-mobile', branch: 'mobile-app-init', isMain: false },
  ],
}];

const sessions = [{
  id: 'mock-session',
  worktreeId: 'wt-mobile',
  name: 'Mobile app implementation',
  customName: false,
  sdkSessionId: 'mock-sdk-session',
  status: 'idle',
  model: 'claude-sonnet-4-6',
  thinkingEnabled: false,
  extendedContext: false,
  effortLevel: 'default',
  planModeEnabled: false,
  createdAt: Date.now(),
  worktreePath: '/mock/braid-mobile',
  messageCount: 2,
  messages: [
    { id: 'm1', role: 'user', content: 'Build the mobile app', timestamp: Date.now() - 60_000 },
    { id: 'm2', role: 'assistant', content: 'I added the core mobile dashboard and pairing flow.', timestamp: Date.now() - 30_000 },
  ],
}];

const server = new WebSocketServer({ port, host: '0.0.0.0' });

server.on('connection', (ws) => {
  let sharedKey: Uint8Array | null = null;
  let counter = 0;
  let authed = false;
  let eventTimer: NodeJS.Timeout | null = null;

  ws.on('message', (raw) => {
    try {
      const text = raw.toString();
      if (!sharedKey) {
        const hello = JSON.parse(text) as { type: string; ephemeralPublicKey: string; deviceToken: string };
        if (hello.deviceToken !== token) throw new Error('invalid token');
        const serverEphemeral = nacl.box.keyPair();
        sharedKey = nacl.box.before(fromBase64(hello.ephemeralPublicKey), serverEphemeral.secretKey);
        ws.send(JSON.stringify({ type: 'e2ee_ready', serverEphemeralPublicKey: toBase64(serverEphemeral.publicKey) }));
        return;
      }
      if (!authed) {
        decrypt(text, sharedKey, counter);
        counter += 1;
        ws.send(encrypt({ type: 'e2ee_authenticated', deviceId: 'mock-device', instanceName: 'Braid Mock', deviceToken: token }, sharedKey, counter));
        counter += 1;
        authed = true;
        return;
      }

      const request = decrypt<{ id: number; method: string; params?: Record<string, unknown> }>(text, sharedKey, counter);
      counter += 1;
      const result = handle(request.method, request.params ?? {});
      ws.send(encrypt({ jsonrpc: '2.0', id: request.id, result }, sharedKey, counter));
      counter += 1;

      if (request.method === 'agent.subscribe') {
        eventTimer = setInterval(() => {
          if (!sharedKey || ws.readyState !== ws.OPEN) return;
          ws.send(encrypt({
            jsonrpc: '2.0',
            method: 'agent.event',
            params: { sessionId: request.params?.sessionId, event: { type: 'activity', activity: 'Mock agent heartbeat' } },
          }, sharedKey, counter));
          counter += 1;
        }, 3500);
      }
    } catch (error) {
      ws.close(4001, error instanceof Error ? error.message : String(error));
    }
  });

  ws.on('close', () => {
    if (eventTimer) clearInterval(eventTimer);
  });
});

function handle(method: string, params: Record<string, unknown>): unknown {
  switch (method) {
    case 'status.get':
      return { instanceName: 'Braid Mock', version: '0.0.0', protocolVersion: 1, projects: projects.map(({ worktrees, ...p }) => p), uptime: 42 };
    case 'projects.list':
      return projects;
    case 'sessions.list':
      return sessions;
    case 'sessions.get':
      return sessions.find((session) => session.id === params.sessionId) ?? null;
    case 'sessions.sendMessage':
      sessions[0].messages.push({ id: `m${Date.now()}`, role: 'user', content: String(params.message ?? ''), timestamp: Date.now() });
      sessions[0].messageCount = sessions[0].messages.length;
      return null;
    case 'terminal.list':
      return [{ ptyId: 'mock-pty', cwd: '/mock/braid-mobile' }];
    case 'terminal.readScrollback':
      return '$ yarn typecheck\nok\n';
    case 'terminal.write':
      return null;
    case 'terminal.subscribe':
    case 'agent.subscribe':
      return { subscriptionId: `sub-${Date.now()}` };
    case 'git.status':
      return [{ file: 'mobile-app/src/app/index.tsx', status: 'M', staged: false, additions: 32, deletions: 4 }];
    case 'git.fileDiff':
      return 'diff --git a/mobile-app/src/app/index.tsx b/mobile-app/src/app/index.tsx\n+Mock diff output\n';
    case 'worktrees.create':
    case 'worktrees.remove':
    case 'sessions.stop':
      return null;
    default:
      throw new Error(`Method not found: ${method}`);
  }
}

const payload = Buffer.from(JSON.stringify({
  endpoint: `ws://${lanIp()}:${port}`,
  token,
  serverPublicKey: toBase64(serverKeyPair.publicKey),
}), 'utf8').toString('base64');

console.log(`Braid mock mobile server listening on ws://${lanIp()}:${port}`);
console.log(`Pairing payload:\n${payload}`);
