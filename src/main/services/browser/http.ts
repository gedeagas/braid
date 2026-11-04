// Loopback HTTP routes for terminal agents (CLI shim + stdio MCP bridge).
// Mounted on the agent hook server, sharing its port and token:
//   GET  /browser/tools  -> tool specs
//   POST /browser/call   -> { name, args, cwd } -> BrowserToolResult
import type { IncomingMessage, ServerResponse } from 'http'
import { BROWSER_TOOLS } from '../../../shared/browserTools'
import { runBrowserTool } from './automation/tools'

const MAX_BODY_BYTES = 1_000_000

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

export function isBrowserRoute(url: string | undefined): boolean {
  return Boolean(url && (url === '/browser/tools' || url === '/browser/call'))
}

export function handleBrowserRoute(req: IncomingMessage, res: ServerResponse, token: string): void {
  if (!token || req.headers['x-braid-token'] !== token) { send(res, 403, { error: 'forbidden' }); return }
  if (req.url === '/browser/tools') {
    if (req.method !== 'GET') { send(res, 405, { error: 'method not allowed' }); return }
    send(res, 200, { tools: BROWSER_TOOLS })
    return
  }
  if (req.method !== 'POST') { send(res, 405, { error: 'method not allowed' }); return }
  const chunks: Buffer[] = []
  let size = 0
  let rejected = false
  req.on('data', (chunk: Buffer) => {
    size += chunk.length
    if (size > MAX_BODY_BYTES && !rejected) {
      rejected = true
      send(res, 413, { error: 'body too large' })
      req.destroy()
      return
    }
    chunks.push(chunk)
  })
  req.on('end', () => {
    if (rejected) return
    let parsed: { name?: unknown; args?: unknown; cwd?: unknown }
    try {
      parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof parsed
    } catch {
      send(res, 400, { error: 'invalid JSON' })
      return
    }
    if (typeof parsed.name !== 'string') { send(res, 400, { error: 'missing tool name' }); return }
    runBrowserTool(parsed.name, parsed.args ?? {}, { cwd: typeof parsed.cwd === 'string' ? parsed.cwd : undefined })
      .then((result) => send(res, 200, result))
      .catch((err: unknown) => send(res, 500, { text: err instanceof Error ? err.message : String(err), isError: true }))
  })
}
