import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn, type ChildProcess } from 'child_process'
import { request } from 'http'
import { serveSimGuardNodeOptions } from '../serveSimGuard'

// A server that asks for every interface (like serve-sim's CDP bridge) and
// answers HTTP + upgrades. The guard must pin it to loopback and filter requests.
const FIXTURE = `
import http from 'node:http';
const server = http.createServer((_req, res) => res.end('ok'));
server.on('upgrade', (_req, socket) => socket.end('HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\n\\r\\n'));
server.listen(0, '::', () => {
  const { address, port } = server.address();
  process.stdout.write(JSON.stringify({ address, port }) + '\\n');
});
`

let child: ChildProcess
let port = 0
let address = ''

function get(headers: Record<string, string>, upgrade = false): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1', port, path: '/exec', setHost: false,
      headers: upgrade ? { ...headers, Connection: 'Upgrade', Upgrade: 'websocket' } : headers,
    })
    req.on('response', (res) => { res.resume(); resolve(res.statusCode ?? 0) })
    req.on('upgrade', (res, socket) => { socket.destroy(); resolve(res.statusCode ?? 0) })
    req.on('error', reject)
    req.end()
  })
}

beforeAll(async () => {
  child = spawn(process.execPath, ['--input-type=module', '-e', FIXTURE], {
    env: { ...process.env, NODE_OPTIONS: serveSimGuardNodeOptions() },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const info = await new Promise<{ address: string; port: number }>((resolve, reject) => {
    child.stdout!.once('data', (chunk: Buffer) => resolve(JSON.parse(chunk.toString())))
    child.once('exit', (code) => reject(new Error(`fixture exited (${code})`)))
  })
  ;({ port, address } = info)
})

afterAll(() => { child?.kill() })

describe('serve-sim loopback guard', () => {
  it('pins listen() to IPv4 loopback even when asked for all interfaces', () => {
    expect(address).toBe('127.0.0.1')
  })

  it('allows requests addressed to this loopback port', async () => {
    expect(await get({ Host: `127.0.0.1:${port}` })).toBe(200)
    expect(await get({ Host: `localhost:${port}`, Origin: 'http://127.0.0.1:3200' })).toBe(200)
    expect(await get({ Host: `127.0.0.1:${port}`, 'Sec-Fetch-Site': 'same-site' })).toBe(200)
  })

  it('rejects DNS-rebound Host headers', async () => {
    expect(await get({ Host: `evil.example:${port}` })).toBe(403)
    expect(await get({ Host: '127.0.0.1:1' })).toBe(403)
    // Node's parser already rejects a missing Host (400) before the guard runs
    expect(await get({})).not.toBe(200)
  })

  it('rejects cross-site browser requests', async () => {
    expect(await get({ Host: `127.0.0.1:${port}`, Origin: 'https://evil.example' })).toBe(403)
    expect(await get({ Host: `127.0.0.1:${port}`, Origin: 'null' })).toBe(403)
    expect(await get({ Host: `127.0.0.1:${port}`, 'Sec-Fetch-Site': 'cross-site' })).toBe(403)
  })

  it('applies the same checks to WebSocket upgrades', async () => {
    expect(await get({ Host: `127.0.0.1:${port}` }, true)).toBe(101)
    expect(await get({ Host: `evil.example:${port}` }, true)).toBe(403)
    expect(await get({ Host: `127.0.0.1:${port}`, Origin: 'https://evil.example' }, true)).toBe(403)
  })
})
