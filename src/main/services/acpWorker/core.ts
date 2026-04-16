/**
 * AcpWorker - Agent Client Protocol worker implementation.
 *
 * Spawns an ACP-compatible agent as a subprocess (e.g., Gemini CLI),
 * communicates over stdio using JSON-RPC 2.0 (NDJSON), and emits
 * WorkerEvent types identical to AgentWorker so the coordinator
 * and renderer need zero changes.
 *
 * This file runs in a UtilityProcess (acpProcess.ts).
 * Only Node.js APIs are available - no Electron imports.
 */

import { spawn, type ChildProcess } from 'child_process'
import type { WorkerEvent, AgentSettings, AgentBackend, AcpAgentConfig } from '../agentTypes'
import { createClientHandlers, type ClientHandlers } from './clientHandlers'
import { finalizeTurn } from './eventMapper'

/** JSON-RPC 2.0 allows both number and string IDs. */
type RpcId = number | string

const RPC_TIMEOUT_MS = 60_000

interface PendingRpc {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface AcpSession {
  acpSessionId: string
  agentProcess: ChildProcess
  clientHandlers: ClientHandlers
  /** Buffered NDJSON data from stdout. */
  stdoutBuffer: string
  /** Per-session pending RPCs to avoid cross-session ID collisions. */
  pendingRpc: Map<number, PendingRpc>
  /** Per-session RPC ID counter. */
  rpcId: number
}

/**
 * AcpWorker manages ACP agent subprocesses.
 * One AcpWorker instance per UtilityProcess, can handle one session at a time.
 */
export class AcpWorker {
  private emit: (event: WorkerEvent) => void
  private sessions = new Map<string, AcpSession>()
  /**
   * Agent config injected from the coordinator (main process reads the config
   * file, then passes it via the startSession command). This avoids importing
   * Electron's `app` module which is unavailable in UtilityProcess.
   */
  private agentConfig: AcpAgentConfig | null = null

  constructor(emit: (event: WorkerEvent) => void) {
    this.emit = emit
  }

  async startSession(
    sessionId: string,
    _worktreeId: string,
    _projectName: string,
    worktreePath: string,
    prompt: string,
    _model: string,
    _thinking: boolean,
    _planMode: boolean,
    _sessionName: string = 'New Chat',
    _settings: AgentSettings,
    _images?: string[],
    _additionalDirectories?: string[],
    _linkedWorktreeContext?: string,
    _connectedDeviceId?: string,
    _mobileFramework?: string,
    backend?: AgentBackend,
    agentConfig?: AcpAgentConfig
  ): Promise<void> {
    try {
      // Prefer injected config from coordinator, fall back to stored
      const config = agentConfig ?? this.agentConfig
      if (!config) {
        const agentId = backend?.type === 'acp' ? backend.agentId : ''
        this.emit({ type: 'error', sessionId, message: `ACP agent "${agentId}" not found in configuration` })
        return
      }
      this.agentConfig = config

      // Spawn agent subprocess
      const agentProcess = spawn(config.command, config.args, {
        stdio: ['pipe', 'pipe', 'inherit'],
        cwd: worktreePath,
        env: { ...process.env, ...config.env }
      })

      agentProcess.on('error', (err) => {
        this.emit({ type: 'error', sessionId, message: `Failed to spawn ACP agent: ${err.message}` })
      })

      // Set up client handlers for the ACP callbacks
      const clientHandlers = createClientHandlers(sessionId, worktreePath, this.emit)

      const session: AcpSession = {
        acpSessionId: '',
        agentProcess,
        clientHandlers,
        stdoutBuffer: '',
        pendingRpc: new Map(),
        rpcId: 0,
      }
      this.sessions.set(sessionId, session)

      agentProcess.on('exit', (code) => {
        // Reject all pending RPCs for this session
        this.rejectAllPendingRpc(session, `ACP agent exited (code ${code})`)
        // Clean up pending permissions
        clientHandlers.cleanup()
        if (this.sessions.has(sessionId)) {
          this.sessions.delete(sessionId)
        }
        // Don't emit error on normal exit (code 0)
        if (code !== 0 && code !== null) {
          this.emit({ type: 'error', sessionId, message: `ACP agent exited with code ${code}` })
        }
      })

      // Set up NDJSON reader on stdout
      this.setupStdoutReader(sessionId, session)

      // ACP handshake: initialize -> newSession -> prompt
      await this.sendRpc(session, 'initialize', {
        protocolVersion: 1,
        clientInfo: { name: 'Braid', version: '1.0.0' },
        clientCapabilities: {
          fileSystem: true,
          terminal: false // Terminal support comes in phase 2
        }
      })

      const newSessionResult = await this.sendRpc(session, 'session/new', {
        cwd: worktreePath
      })
      session.acpSessionId = (newSessionResult as Record<string, unknown>)?.sessionId as string ?? `acp-${Date.now()}`

      // Emit init event
      this.emit({
        type: 'init',
        sessionId,
        sdkSessionId: session.acpSessionId,
        slashCommands: []
      })

      // Send the prompt - notifications arrive during the RPC await
      clientHandlers.resetTurn()
      await this.sendRpc(session, 'session/prompt', {
        sessionId: session.acpSessionId,
        prompt: [{ type: 'text', text: prompt }]
      })

      // Finalize the turn (close any open blocks, emit result)
      const finalEvents = finalizeTurn(sessionId, clientHandlers.getTurnState())
      for (const event of finalEvents) this.emit(event)

      this.emit({ type: 'done', sessionId })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.emit({ type: 'error', sessionId, message: `ACP session error: ${message}` })
    }
  }

  async sendMessage(
    sessionId: string,
    message: string,
    _sdkSessionId: string,
    _cwd: string,
    _model: string,
    _planMode: boolean,
    _sessionName: string = 'New Chat',
    _settings: AgentSettings,
    _images?: string[],
    _additionalDirectories?: string[],
    _linkedWorktreeContext?: string,
    _connectedDeviceId?: string,
    _mobileFramework?: string
  ): Promise<void> {
    try {
      const session = this.sessions.get(sessionId)
      if (!session) {
        this.emit({ type: 'error', sessionId, message: 'ACP session not found - cannot resume' })
        return
      }

      session.clientHandlers.resetTurn()
      await this.sendRpc(session, 'session/prompt', {
        sessionId: session.acpSessionId,
        prompt: [{ type: 'text', text: message }]
      })

      const finalEvents = finalizeTurn(sessionId, session.clientHandlers.getTurnState())
      for (const event of finalEvents) this.emit(event)

      this.emit({ type: 'done', sessionId })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.emit({ type: 'error', sessionId, message: `ACP message error: ${message}` })
    }
  }

  stopSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      this.rejectAllPendingRpc(session, 'Session stopped')
      session.clientHandlers.cleanup()
      session.agentProcess?.kill('SIGTERM')
    }
    this.sessions.delete(sessionId)
    this.emit({ type: 'done', sessionId })
  }

  closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      this.rejectAllPendingRpc(session, 'Session closed')
      session.clientHandlers.cleanup()
      session.agentProcess?.kill('SIGKILL')
    }
    this.sessions.delete(sessionId)
  }

  answerToolInput(sessionId: string, result: Record<string, unknown>): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    // Find the permission ID from the result and resolve it
    const toolUseId = result.toolUseId as string | undefined
    if (toolUseId) {
      session.clientHandlers.resolvePermission(toolUseId, result)
    }
  }

  answerElicitation(_sessionId: string, _result: { action: string; content?: Record<string, unknown> }): void {
    // No-op for ACP agents (no elicitation support yet)
  }

  updateSessionName(_sessionId: string, _name: string): void {
    // No-op for ACP agents
  }

  // -- JSON-RPC over NDJSON --------------------------------------------------

  private sendRpc(session: AcpSession, method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++session.rpcId

      const timer = setTimeout(() => {
        session.pendingRpc.delete(id)
        reject(new Error(`ACP RPC timeout after ${RPC_TIMEOUT_MS}ms (method: ${method})`))
      }, RPC_TIMEOUT_MS)

      session.pendingRpc.set(id, { resolve, reject, timer })

      const message = JSON.stringify({ jsonrpc: '2.0', id, method, params })
      const stdin = session.agentProcess.stdin
      if (!stdin || !stdin.writable) {
        clearTimeout(timer)
        session.pendingRpc.delete(id)
        reject(new Error(`Failed to write to ACP agent stdin (method: ${method})`))
        return
      }
      const ok = stdin.write(message + '\n')
      if (!ok) {
        clearTimeout(timer)
        session.pendingRpc.delete(id)
        reject(new Error(`Failed to write to ACP agent stdin (method: ${method})`))
      }
    })
  }

  /** Reject all pending RPCs for a session and clear their timers. */
  private rejectAllPendingRpc(session: AcpSession, reason: string): void {
    for (const [id, pending] of session.pendingRpc) {
      clearTimeout(pending.timer)
      pending.reject(new Error(reason))
    }
    session.pendingRpc.clear()
  }

  private setupStdoutReader(sessionId: string, session: AcpSession): void {
    const stdout = session.agentProcess.stdout
    if (!stdout) return

    stdout.setEncoding('utf-8')
    stdout.on('data', (chunk: string) => {
      session.stdoutBuffer += chunk
      const lines = session.stdoutBuffer.split('\n')
      // Keep the last incomplete line in the buffer
      session.stdoutBuffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const msg = JSON.parse(line) as Record<string, unknown>
          this.handleIncomingMessage(sessionId, session, msg)
        } catch {
          // Skip unparseable lines
        }
      }
    })
  }

  private handleIncomingMessage(
    sessionId: string,
    session: AcpSession,
    msg: Record<string, unknown>
  ): void {
    // JSON-RPC response (has 'id' field - supports both number and string IDs)
    if (msg.id != null && (typeof msg.id === 'number' || typeof msg.id === 'string')) {
      const numericId = typeof msg.id === 'string' ? parseInt(msg.id, 10) : msg.id
      const pending = session.pendingRpc.get(numericId)
      if (pending) {
        clearTimeout(pending.timer)
        session.pendingRpc.delete(numericId)
        if (msg.error) {
          const err = msg.error as Record<string, unknown>
          pending.reject(new Error((err.message as string) ?? 'ACP RPC error'))
        } else {
          pending.resolve(msg.result)
        }
      }
      return
    }

    // JSON-RPC notification (no 'id' field)
    const method = msg.method as string | undefined
    const params = msg.params as Record<string, unknown> | undefined

    if (!method || !params) return

    switch (method) {
      case 'session/update':
        session.clientHandlers.sessionUpdate(params)
        break

      case 'fs/read_text_file':
        this.handleAgentRequest(session, msg, async () => {
          return await session.clientHandlers.readTextFile({ path: params.path as string })
        })
        break

      case 'fs/write_text_file':
        this.handleAgentRequest(session, msg, async () => {
          return await session.clientHandlers.writeTextFile({
            path: params.path as string,
            content: params.content as string
          })
        })
        break

      case 'request/permission':
        this.handleAgentRequest(session, msg, async () => {
          return await session.clientHandlers.requestPermission(params)
        })
        break
    }
  }

  /** Handle an agent-initiated JSON-RPC request by running the handler and sending back the response. */
  private async handleAgentRequest(
    session: AcpSession,
    msg: Record<string, unknown>,
    handler: () => Promise<unknown>
  ): Promise<void> {
    const id = msg.id
    const stdin = session.agentProcess.stdin
    try {
      const result = await handler()
      const response = JSON.stringify({ jsonrpc: '2.0', id, result })
      if (stdin?.writable) stdin.write(response + '\n')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const response = JSON.stringify({
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message }
      })
      if (stdin?.writable) stdin.write(response + '\n')
    }
  }
}
