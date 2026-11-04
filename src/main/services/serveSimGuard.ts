/**
 * Loopback guard preloaded into every serve-sim Node process (the preview
 * server and the per-device helpers it respawns) via NODE_OPTIONS=--import.
 *
 * serve-sim exposes a shell-exec route (`/exec`) protected only by a token
 * embedded in its preview page, sends `Access-Control-Allow-Origin: *`, and
 * never validates the Host header. Any website could DNS-rebind its hostname to
 * 127.0.0.1, read the page "same-origin", and run commands on the host. The
 * inspect-webkit CDP bridge also binds `::` (all interfaces) when asked for
 * loopback. This guard closes both without patching serve-sim's bundle:
 *
 * - every TCP `listen()` is pinned to 127.0.0.1
 * - every HTTP request / WebSocket upgrade must carry `Host: 127.0.0.1|localhost:<this port>`
 *   (defeats DNS rebinding), a loopback `Origin` if any, and must not be
 *   `Sec-Fetch-Site: cross-site` (blocks CSRF from real websites)
 *
 * Kept as plain JS source so it runs without a build step. If it fails to load,
 * Node aborts startup and Braid falls back to the mobilecli stream (fail closed).
 */
export const SERVE_SIM_GUARD_SOURCE = String.raw`
import http from 'node:http';
import net from 'node:net';

const LOOPBACK_V4 = '127.0.0.1';
const LOOPBACK_NAMES = new Set(['127.0.0.1', 'localhost']);

const originalListen = net.Server.prototype.listen;
net.Server.prototype.listen = function (...args) {
  const [first] = args;
  if (first && typeof first === 'object' && !Array.isArray(first)) {
    // listen(options) - leave unix sockets and inherited handles alone
    if (first.path === undefined && first.fd === undefined && first._handle === undefined && first.handle === undefined) {
      const { ipv6Only, ...rest } = first;
      args[0] = { ...rest, host: LOOPBACK_V4 };
    }
  } else if (typeof first === 'number' || (typeof first === 'string' && /^\d+$/.test(first))) {
    // listen(port, [host], [backlog], [cb])
    if (typeof args[1] === 'string') args[1] = LOOPBACK_V4;
    else args.splice(1, args[1] === undefined && args.length > 1 ? 1 : 0, LOOPBACK_V4);
  } else if (first === undefined || typeof first === 'function') {
    // listen() / listen(cb) - random port on all interfaces by default
    args.splice(0, first === undefined && args.length > 0 ? 1 : 0, 0, LOOPBACK_V4);
  }
  return originalListen.apply(this, args);
};

function isAllowed(server, headers) {
  const address = server.address();
  if (!address || typeof address !== 'object') return false;
  let host;
  try { host = new URL('http://' + (headers.host || '')); } catch { return false; }
  if (!LOOPBACK_NAMES.has(host.hostname) || host.port !== String(address.port)) return false;
  const origin = headers.origin;
  if (origin !== undefined) {
    let parsed;
    try { parsed = new URL(origin); } catch { return false; }
    if (!/^https?:$/.test(parsed.protocol) || !LOOPBACK_NAMES.has(parsed.hostname)) return false;
  }
  return headers['sec-fetch-site'] !== 'cross-site';
}

const originalEmit = http.Server.prototype.emit;
http.Server.prototype.emit = function (event, ...args) {
  if (event === 'request') {
    const [req, res] = args;
    if (!isAllowed(this, req.headers)) {
      res.writeHead(403, { 'Content-Type': 'text/plain', Connection: 'close' });
      res.end('Forbidden');
      return true;
    }
  } else if (event === 'upgrade') {
    const [req, socket] = args;
    if (!isAllowed(this, req.headers)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      socket.destroy();
      return true;
    }
  }
  return originalEmit.call(this, event, ...args);
};
`

/** NODE_OPTIONS value that preloads the guard; inherited by serve-sim's respawned helpers. */
export function serveSimGuardNodeOptions(): string {
  const encoded = Buffer.from(SERVE_SIM_GUARD_SOURCE, 'utf8').toString('base64')
  return `--import=data:text/javascript;base64,${encoded}`
}
