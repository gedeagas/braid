// ── Agent Hook HTTP Server ───────────────────────────────────────────────────
//
// Lightweight loopback HTTP server that receives status callbacks from
// Claude Code hooks running inside Braid's big terminals.
//
// Architecture (mirrors Orca):
//   1. Hook script POSTs JSON to http://127.0.0.1:<port>/hook/agent
//   2. Server maps the Claude Code hook event to an agent status state
//   3. Forwards the status update to the renderer via BrowserWindow IPC
//
// The server binds to 127.0.0.1 only (no network exposure).
// A random auth token prevents other local processes from injecting events.

import http from 'http'
import { randomUUID } from 'crypto'
import { mkdirSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { BrowserWindow } from 'electron'

/** Well-known config file path. Hook scripts read this to get the current port/token. */
const HOOK_CONFIG_PATH = join(homedir(), '.braid', 'hooks', 'hook-server.json')

// ── Types ────────────────────────────────────────────────────────────────────

export interface AgentHookStatus {
  terminalId: string
  state: 'working' | 'blocked' | 'waiting' | 'done'
  agentType: 'claude'
  toolName?: string
  interrupted?: boolean
}

interface HookRequestBody {
  terminalId: string
  event: string
  toolName?: string
  isInterrupt?: boolean
}

// ── Event Mapping ────────────────────────────────────────────────────────────

function mapEventToState(event: string): AgentHookStatus['state'] | null {
  switch (event) {
    case 'UserPromptSubmit': return 'working'
    case 'PreToolUse':       return 'working'
    case 'PostToolUse':      return 'working'
    case 'PermissionRequest': return 'waiting'
    case 'Stop':             return 'done'
    default:                 return null
  }
}

// ── Server ───────────────────────────────────────────────────────────────────

let server: http.Server | null = null
let serverPort = 0
let serverToken = ''

/** Start the loopback HTTP server. Returns the port and auth token. */
export async function startAgentHookServer(): Promise<{ port: number; token: string }> {
  if (server) return { port: serverPort, token: serverToken }

  serverToken = randomUUID()

  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      // Only accept POST /hook/agent
      if (req.method !== 'POST' || req.url !== '/hook/agent') {
        res.writeHead(404)
        res.end()
        return
      }

      // Validate auth token
      if (req.headers['x-braid-token'] !== serverToken) {
        res.writeHead(403)
        res.end()
        return
      }

      // Read body
      let body = ''
      let rejected = false
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString()
        // Limit body size to prevent abuse
        if (!rejected && body.length > 16_384) {
          rejected = true
          res.writeHead(413)
          res.end()
          req.destroy()
        }
      })

      req.on('end', () => {
        if (rejected) return
        res.writeHead(200)
        res.end('ok')

        try {
          const parsed = JSON.parse(body) as HookRequestBody
          if (!parsed.terminalId || !parsed.event) return

          const state = mapEventToState(parsed.event)
          if (!state) return

          const status: AgentHookStatus = {
            terminalId: parsed.terminalId,
            state,
            agentType: 'claude',
            toolName: state === 'done' ? undefined : parsed.toolName,
            interrupted: parsed.isInterrupt ?? false,
          }

          // Forward to renderer via IPC
          const win = BrowserWindow.getAllWindows()[0]
          if (win && !win.isDestroyed()) {
            win.webContents.send('agent-hook:status', status)
          }
        } catch {
          // Malformed JSON - ignore
        }
      })
    })

    srv.on('error', reject)

    // Bind to loopback only, port 0 = OS-assigned random port
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      if (typeof addr === 'object' && addr) {
        serverPort = addr.port
        server = srv
        // Write port/token to a well-known config file so hook scripts in
        // surviving daemon PTY sessions can discover the new server after
        // Electron restarts (env vars in those sessions are stale).
        writeHookConfig(serverPort, serverToken)
        console.log(`[agentHookServer] Listening on 127.0.0.1:${serverPort}`)
        resolve({ port: serverPort, token: serverToken })
      } else {
        reject(new Error('Failed to get server address'))
      }
    })
  })
}

/** Stop the HTTP server. */
export function stopAgentHookServer(): void {
  if (server) {
    server.close()
    server = null
    serverPort = 0
    serverToken = ''
    removeHookConfig()
  }
}

/** Write port/token to a well-known file so hook scripts can read the current values. */
function writeHookConfig(port: number, token: string): void {
  try {
    const dir = join(homedir(), '.braid', 'hooks')
    mkdirSync(dir, { recursive: true })
    writeFileSync(HOOK_CONFIG_PATH, JSON.stringify({ port, token }), { mode: 0o600 })
  } catch {
    // Non-fatal - hooks may fail for surviving daemon sessions but fresh spawns still work via env vars
  }
}

/** Remove the hook config file on server stop. */
function removeHookConfig(): void {
  try { unlinkSync(HOOK_CONFIG_PATH) } catch { /* may not exist */ }
}

/** Get the current server port (0 if not started). */
export function getHookServerPort(): number {
  return serverPort
}

/** Get the current auth token (empty if not started). */
export function getHookServerToken(): string {
  return serverToken
}
