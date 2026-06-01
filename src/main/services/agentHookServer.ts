// ── Agent Hook HTTP Server ───────────────────────────────────────────────────
//
// Lightweight loopback HTTP server that receives status callbacks from
// agent hooks running inside Braid's big terminals.
//
// Architecture:
//   1. Hook script POSTs JSON to http://127.0.0.1:<port>/hook/<agentId>
//   2. Server maps the agent-specific hook event to a unified status state
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
import type { AgentHookTarget } from './agentHooks/types'

/** Well-known config file path. Hook scripts read this to get the current port/token. */
const HOOK_CONFIG_PATH = join(homedir(), '.braid', 'hooks', 'hook-server.json')

// ── Types ────────────────────────────────────────────────────────────────────

type AgentStatusState = 'working' | 'blocked' | 'waiting' | 'done'

export interface AgentHookStatus {
  terminalId: string
  state: AgentStatusState
  agentType: AgentHookTarget
  toolName?: string
  interrupted?: boolean
}

interface HookRequestBody {
  terminalId: string
  event: string
  toolName?: string
  isInterrupt?: boolean
}

// ── Main-process status listeners ────────────────────────────────────────────
//
// Besides forwarding to the renderer, hook status is delivered to in-process
// listeners. This lets the main process react (e.g. push mobile notifications)
// without depending on the renderer having the terminal mounted.

type HookStatusListener = (status: AgentHookStatus) => void
const hookStatusListeners = new Set<HookStatusListener>()

export function onHookStatus(listener: HookStatusListener): () => void {
  hookStatusListeners.add(listener)
  return () => hookStatusListeners.delete(listener)
}

// ── Per-Agent Event-to-State Mappings ────────────────────────────────────────

const EVENT_MAPS: Record<AgentHookTarget, Record<string, AgentStatusState>> = {
  claude: {
    SessionStart: 'working',
    UserPromptSubmit: 'working',
    PreToolUse: 'working',
    PostToolUse: 'working',
    PostToolUseFailure: 'working',
    PermissionRequest: 'waiting',
    Stop: 'done',
  },
  gemini: {
    BeforeAgent: 'working',
    AfterTool: 'working',
    PreToolUse: 'working',
    PostToolUse: 'working',
    AfterAgent: 'done',
  },
  antigravity: {
    PreInvocation: 'working',
    PostInvocation: 'done',
    PostToolUse: 'working',
    Stop: 'done',
  },
  codex: {
    SessionStart: 'working',
    UserPromptSubmit: 'working',
    PreToolUse: 'working',
    PostToolUse: 'working',
    PermissionRequest: 'waiting',
    Stop: 'done',
  },
  copilot: {
    SessionStart: 'working',
    UserPromptSubmit: 'working',
    PreToolUse: 'working',
    PostToolUse: 'working',
    PostToolUseFailure: 'working',
    subagentStart: 'working',
    PreCompact: 'working',
    PermissionRequest: 'working',
    ErrorOccurred: 'blocked',
    Notification: 'blocked',
    SubagentStop: 'done',
    SessionEnd: 'done',
    Stop: 'done',
  },
  cursor: {
    beforeSubmitPrompt: 'working',
    preToolUse: 'working',
    postToolUse: 'working',
    postToolUseFailure: 'working',
    afterAgentResponse: 'working',
    beforeShellExecution: 'waiting',
    beforeMCPExecution: 'waiting',
    stop: 'done',
  },
  grok: {
    SessionStart: 'working',
    UserPromptSubmit: 'working',
    PreToolUse: 'working',
    PostToolUse: 'working',
    PostToolUseFailure: 'working',
    Notification: 'blocked',
    Stop: 'done',
    SessionEnd: 'done',
  },
  droid: {
    SessionStart: 'working',
    UserPromptSubmit: 'working',
    PreToolUse: 'working',
    PostToolUse: 'working',
    PermissionRequest: 'waiting',
    Notification: 'blocked',
    Stop: 'done',
  },
  hermes: {
    on_session_start: 'working',
    pre_llm_call: 'working',
    pre_tool_call: 'working',
    post_tool_call: 'working',
    post_approval_response: 'working',
    pre_approval_request: 'waiting',
    post_llm_call: 'done',
    on_session_end: 'done',
    on_session_finalize: 'done',
    on_session_reset: 'done',
  },
}

const CODEX_USER_INPUT_TOOL_NAME = 'request_user_input'

/** Valid agent IDs for URL routing. */
const VALID_AGENTS = new Set<string>(Object.keys(EVENT_MAPS))

/** Parse agentId from URL path. Supports /hook/<agentId> and legacy /hook/agent. */
function parseRoute(url: string | undefined): AgentHookTarget | null {
  if (!url) return null
  const match = url.match(/^\/hook\/([a-z]+)$/)
  if (!match) return null
  const id = match[1]
  // Backward compat: /hook/agent maps to claude
  if (id === 'agent') return 'claude'
  if (VALID_AGENTS.has(id)) return id as AgentHookTarget
  return null
}

/** Map an event name to a status state using the agent-specific mapping. */
export function mapHookEventToState(
  agentId: AgentHookTarget,
  event: string,
  toolName?: string
): AgentStatusState | null {
  // Codex prompts created by request_user_input block on the user before the
  // tool completes, so treat its PreToolUse hook as a waiting-for-input state.
  if (agentId === 'codex' && event === 'PreToolUse' && toolName === CODEX_USER_INPUT_TOOL_NAME) {
    return 'waiting'
  }
  return EVENT_MAPS[agentId]?.[event] ?? null
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
      // Only accept POST /hook/<agentId>
      if (req.method !== 'POST') {
        res.writeHead(404)
        res.end()
        return
      }

      const agentId = parseRoute(req.url)
      if (!agentId) {
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

          const state = mapHookEventToState(agentId, parsed.event, parsed.toolName)
          if (!state) return

          const status: AgentHookStatus = {
            terminalId: parsed.terminalId,
            state,
            agentType: agentId,
            toolName: state === 'done' ? undefined : parsed.toolName,
            interrupted: parsed.isInterrupt ?? false,
          }

          // Forward to renderer via IPC
          const win = BrowserWindow.getAllWindows()[0]
          if (win && !win.isDestroyed()) {
            win.webContents.send('agent-hook:status', status)
          }

          // Deliver to in-process listeners (e.g. mobile notification bridge),
          // which run regardless of whether the renderer has this terminal open.
          for (const listener of hookStatusListeners) {
            try { listener(status) } catch { /* a listener must not block others */ }
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
