/**
 * AcpWorker - Agent Client Protocol worker implementation.
 *
 * Spawns an ACP-compatible agent as a subprocess (e.g., Gemini CLI),
 * communicates over stdio using JSON-RPC 2.0 (NDJSON), and emits
 * WorkerEvent types identical to AgentWorker so the coordinator
 * and renderer need zero changes.
 *
 * ⚠️  This file runs in a UtilityProcess (acpProcess.ts).
 *     Only Node.js APIs are available - no Electron imports.
 */

import { spawn, type ChildProcess } from 'child_process'
import type { WorkerEvent, AgentSettings, AgentBackend } from '../agentTypes'
import { acpConfigService } from '../acpConfig'
import { createClientHandlers, type ClientHandlers } from './clientHandlers'
import { finalizeTurn } from './eventMapper'

interface AcpSession {
  acpSessionId: string
  agentProcess: ChildProcess
  clientHandlers: ClientHandlers
  /** Buffered NDJSON data from stdout. */
  stdoutBuffer: string
}

/**
 * AcpWorker manages ACP agent subprocesses.
 * One AcpWorker instance per UtilityProcess, can handle one session at a time.
 */
export class AcpWorker {
  private emit: (event: WorkerEvent) => void
  private sessions = new Map<string, AcpSession>()
  /** Tracks pending JSON-RPC request IDs for correlating responses. */
  private rpcId = 0
  private pendingRpc = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

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
    backend?: AgentBackend
  ): Promise<void> {
    try {
      const agentId = backend?.type === 'acp' ? backend.agentId : ''
      const agentConfig = acpConfigService.get(agentId)
      if (!agentConfig) {
        this.emit({ type: 'error', sessionId, message: `ACP agent "${agentId}" not found in configuration` })
        return
      }

      // Spawn agent subprocess
      const agentProcess = spawn(agentConfig.command, agentConfig.args, {
        stdio: ['pipe', 'pipe', 'inherit'],
        cwd: worktreePath,
        env: { ...process.env, ...agentConfig.env }
      })

      agentProcess.on('error', (err) => {
        this.emit({ type: 'error', sessionId, message: `Failed to spawn ACP agent: ${err.message}` })
      })

      agentProcess.on('exit', (code) => {
        if (this.sessions.has(sessionId)) {
          this.sessions.delete(sessionId)
        }
        // Don't emit error on normal exit (code 0)
        if (code !== 0 && code !== null) {
          this.emit({ type: 'error', sessionId, message: `ACP agent exited with code ${code}` })
        }
      })

      // Set up client handlers for the ACP callbacks
      const clientHandlers = createClientHandlers(sessionId, worktreePath, this.emit)

      const session: AcpSession = {
        acpSessionId: '',
        agentProcess,
        clientHandlers,
        stdoutBuffer: ''
      }
      this.sessions.set(sessionId, session)

      // Set up NDJSON reader on stdout
      this.setupStdoutReader(sessionId, session)

      // ACP handshake: initialize -> newSession -> prompt
      const initResult = await this.sendRpc(session, 'initialize', {
        protocolVersion: 1,
        clientInfo: { name: 'Braid', version: '1.0.0' },
        clientCapabilities: {
          fileSystem: true,
          terminal: false // Terminal support comes in phase 2
        }
      })

      const capabilities = (initResult as Record<string, unknown>)?.capabilities ?? {}

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

      // Send the prompt
      clientHandlers.resetTurn()
      await this.sendRpc(session, 'session/prompt', {
        sessionId: session.acpSessionId,
        prompt: [{ type: 'text', text: prompt }]
      })

      // Finalize the turn
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
    if (session?.agentProcess) {
      session.agentProcess.kill('SIGTERM')
    }
    this.sessions.delete(sessionId)
    this.emit({ type: 'done', sessionId })
  }

  closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session?.agentProcess) {
      session.agentProcess.kill('SIGKILL')
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

  updateSessionName(_sessionId: string, _name: string): void {
    // No-op for ACP agents
  }

  // ── JSON-RPC over NDJSON ────────────────────────────────────────────────

  private sendRpc(session: AcpSession, method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this.rpcId
      this.pendingRpc.set(id, { resolve, reject })

      const message = JSON.stringify({ jsonrpc: '2.0', id, method, params })
      const ok = session.agentProcess.stdin?.write(message + '\n')
      if (!ok) {
        this.pendingRpc.delete(id)
        reject(new Error(`Failed to write to ACP agent stdin (method: ${method})`))
      }
    })
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
    // JSON-RPC response (has 'id' field)
    if (msg.id != null && typeof msg.id === 'number') {
      const pending = this.pendingRpc.get(msg.id)
      if (pending) {
        this.pendingRpc.delete(msg.id)
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
    try {
      const result = await handler()
      const response = JSON.stringify({ jsonrpc: '2.0', id, result })
      session.agentProcess.stdin?.write(response + '\n')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const response = JSON.stringify({
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message }
      })
      session.agentProcess.stdin?.write(response + '\n')
    }
  }
}
