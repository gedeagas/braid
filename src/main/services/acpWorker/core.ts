/**
 * AcpWorker - Agent Client Protocol worker implementation.
 *
 * Spawns an ACP-compatible agent as a subprocess (e.g., Gemini CLI),
 * communicates over stdio using JSON-RPC 2.0 (NDJSON), and emits
 * WorkerEvent types identical to AgentWorker so the coordinator
 * and renderer need zero changes.
 *
 * JSON-RPC protocol handling is delegated to the `json-rpc-2.0` library
 * via JSONRPCServerAndClient: the "client" side sends requests to the
 * agent (initialize, session/new, session/prompt), while the "server"
 * side handles agent-initiated requests (fs/read_text_file, etc.) and
 * notifications (session/update).
 *
 * This file runs in a UtilityProcess (acpProcess.ts).
 * Only Node.js APIs are available - no Electron imports.
 */

import { spawn, type ChildProcess } from 'child_process'
import {
  JSONRPCClient,
  JSONRPCServer,
  JSONRPCServerAndClient,
  JSONRPCErrorException,
} from 'json-rpc-2.0'
import type { WorkerEvent, AgentSettings, AgentBackend, AcpAgentConfig } from '../agentTypes'
import { createClientHandlers, type ClientHandlers } from './clientHandlers'
import { finalizeTurn } from './eventMapper'

const RPC_TIMEOUT_MS = 60_000
const DEBUG = true // Wire-level ACP protocol logging

function debug(...args: unknown[]): void {
  if (DEBUG) console.log('[ACP:debug]', ...args)
}

/** Extract a readable message from JSON-RPC errors (includes code + data). */
function formatRpcError(err: unknown): string {
  if (err instanceof JSONRPCErrorException) {
    const parts = [`[${err.code}] ${err.message}`]
    if (err.data != null) {
      parts.push(typeof err.data === 'string' ? err.data : JSON.stringify(err.data, null, 2))
    }
    return parts.join('\n')
  }
  return err instanceof Error ? err.message : String(err)
}

interface AcpSession {
  acpSessionId: string
  agentProcess: ChildProcess
  clientHandlers: ClientHandlers
  rpc: JSONRPCServerAndClient
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
      debug(`spawn: ${config.command} ${config.args.join(' ')}`)
      debug(`cwd: ${worktreePath}`)
      const agentProcess = spawn(config.command, config.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: worktreePath,
        env: { ...process.env, ...config.env }
      })

      debug(`pid: ${agentProcess.pid}`)

      agentProcess.on('error', (err) => {
        debug(`process error: ${err.message}`)
        this.emit({ type: 'error', sessionId, message: `Failed to spawn ACP agent: ${err.message}` })
      })

      // Capture stderr for debugging (agents often log here)
      if (agentProcess.stderr) {
        agentProcess.stderr.setEncoding('utf-8')
        agentProcess.stderr.on('data', (chunk: string) => {
          debug(`stderr: ${chunk.trimEnd()}`)
        })
      }

      // Set up client handlers for the ACP callbacks
      const clientHandlers = createClientHandlers(sessionId, worktreePath, this.emit)

      // Build the bidirectional JSON-RPC endpoint
      const rpc = this.createRpc(agentProcess, clientHandlers)

      const session: AcpSession = {
        acpSessionId: '',
        agentProcess,
        clientHandlers,
        rpc,
        stdoutBuffer: '',
      }
      this.sessions.set(sessionId, session)

      agentProcess.on('exit', (code, signal) => {
        debug(`exit: code=${code} signal=${signal}`)
        rpc.rejectAllPendingRequests(`ACP agent exited (code ${code})`)
        clientHandlers.cleanup()
        this.sessions.delete(sessionId)
        if (code !== 0 && code !== null) {
          this.emit({ type: 'error', sessionId, message: `ACP agent exited with code ${code}` })
        }
      })

      // Set up NDJSON reader on stdout
      this.setupStdoutReader(session)

      // ACP handshake: initialize -> newSession -> prompt
      const rpcWithTimeout = rpc.timeout(RPC_TIMEOUT_MS)

      debug('>>> initialize')
      const initResult = await rpcWithTimeout.request('initialize', {
        protocolVersion: 1,
        clientInfo: { name: 'Braid', version: '1.0.0' },
        clientCapabilities: {
          fs: {
            readTextFile: true,
            writeTextFile: true
          },
          terminal: true
        }
      })
      debug('<<< initialize:', JSON.stringify(initResult))

      debug('>>> session/new')
      const newSessionResult = await rpcWithTimeout.request('session/new', {
        cwd: worktreePath,
        mcpServers: []
      }) as Record<string, unknown> | undefined
      debug('<<< session/new:', JSON.stringify(newSessionResult))
      session.acpSessionId = (newSessionResult?.sessionId as string) ?? `acp-${Date.now()}`

      // Emit init event
      this.emit({
        type: 'init',
        sessionId,
        sdkSessionId: session.acpSessionId,
        slashCommands: []
      })

      // Send the prompt. The ACP agent sends session/update notifications on
      // stdout during processing, then the RPC response when done. Because both
      // travel over the same pipe and are read sequentially by setupStdoutReader,
      // all notifications written before the response are guaranteed to be
      // dispatched (to clientHandlers.sessionUpdate) before the request resolves.
      debug('>>> session/prompt')
      clientHandlers.resetTurn()
      const promptResult = await rpcWithTimeout.request('session/prompt', {
        sessionId: session.acpSessionId,
        prompt: [{ type: 'text', text: prompt }]
      })
      debug('<<< session/prompt:', JSON.stringify(promptResult))

      // Yield to drain any remaining stdout chunks queued in the same tick.
      await new Promise((r) => setImmediate(r))

      // Finalize the turn (close any open blocks, emit result)
      const finalEvents = finalizeTurn(sessionId, clientHandlers.getTurnState())
      for (const event of finalEvents) this.emit(event)

      this.emit({ type: 'done', sessionId })
    } catch (err) {
      console.error('[AcpWorker] session error:', err)
      this.emit({ type: 'error', sessionId, message: `ACP session error: ${formatRpcError(err)}` })
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
      await session.rpc.timeout(RPC_TIMEOUT_MS).request('session/prompt', {
        sessionId: session.acpSessionId,
        prompt: [{ type: 'text', text: message }]
      })

      // Yield to drain any remaining stdout notification chunks (see startSession)
      await new Promise((r) => setImmediate(r))

      const finalEvents = finalizeTurn(sessionId, session.clientHandlers.getTurnState())
      for (const event of finalEvents) this.emit(event)

      this.emit({ type: 'done', sessionId })
    } catch (err) {
      console.error('[AcpWorker] message error:', err)
      this.emit({ type: 'error', sessionId, message: `ACP message error: ${formatRpcError(err)}` })
    }
  }

  stopSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.rpc.rejectAllPendingRequests('Session stopped')
      session.clientHandlers.cleanup()
      session.agentProcess?.kill('SIGTERM')
    }
    this.sessions.delete(sessionId)
    this.emit({ type: 'done', sessionId })
  }

  closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.rpc.rejectAllPendingRequests('Session closed')
      session.clientHandlers.cleanup()
      session.agentProcess?.kill('SIGKILL')
    }
    this.sessions.delete(sessionId)
  }

  answerToolInput(sessionId: string, result: Record<string, unknown>): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
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

  // -- JSON-RPC wiring -------------------------------------------------------

  /**
   * Create a bidirectional JSON-RPC endpoint for one session.
   *
   * Client side: Braid sends requests to the agent (initialize, session/prompt).
   * Server side: agent sends requests/notifications to Braid (session/update, fs/*).
   */
  private createRpc(agentProcess: ChildProcess, clientHandlers: ClientHandlers): JSONRPCServerAndClient {
    const server = new JSONRPCServer()
    const client = new JSONRPCClient((payload) => {
      const stdin = agentProcess.stdin
      if (!stdin || !stdin.writable) {
        throw new Error('ACP agent stdin is not writable')
      }
      const line = JSON.stringify(payload)
      debug(`--> stdin: ${line}`)
      stdin.write(line + '\n')
    })

    const rpc = new JSONRPCServerAndClient(server, client, {
      errorListener: (msg) => {
        // Log protocol-level errors but don't crash
        console.error(`[AcpWorker] JSON-RPC error: ${msg}`)
      }
    })

    // Register server-side handlers for agent-initiated methods
    rpc.addMethod('session/update', (params) => {
      clientHandlers.sessionUpdate(params as Record<string, unknown>)
      // Notifications don't return a value
    })

    rpc.addMethod('fs/read_text_file', async (params) => {
      const p = params as Record<string, unknown>
      return await clientHandlers.readTextFile({ path: p.path as string })
    })

    rpc.addMethod('fs/write_text_file', async (params) => {
      const p = params as Record<string, unknown>
      return await clientHandlers.writeTextFile({
        path: p.path as string,
        content: p.content as string,
      })
    })

    rpc.addMethod('session/request_permission', async (params) => {
      return await clientHandlers.requestPermission(params as Record<string, unknown>)
    })

    // Terminal methods
    rpc.addMethod('terminal/create', async (params) => {
      const p = params as Record<string, unknown>
      return await clientHandlers.createTerminal({
        command: p.command as string,
        args: p.args as string[] | undefined,
        cwd: p.cwd as string | null | undefined,
        env: p.env as Array<{ name: string; value: string }> | undefined,
        outputByteLimit: p.outputByteLimit as number | null | undefined,
      })
    })

    rpc.addMethod('terminal/output', async (params) => {
      const p = params as Record<string, unknown>
      return await clientHandlers.terminalOutput({ terminalId: p.terminalId as string })
    })

    rpc.addMethod('terminal/wait_for_exit', async (params) => {
      const p = params as Record<string, unknown>
      return await clientHandlers.waitForExit({ terminalId: p.terminalId as string })
    })

    rpc.addMethod('terminal/kill', async (params) => {
      const p = params as Record<string, unknown>
      return await clientHandlers.killTerminal({ terminalId: p.terminalId as string })
    })

    rpc.addMethod('terminal/release', async (params) => {
      const p = params as Record<string, unknown>
      return await clientHandlers.releaseTerminal({ terminalId: p.terminalId as string })
    })

    return rpc
  }

  /**
   * Read NDJSON from stdout and feed each message into the JSON-RPC endpoint.
   * The library figures out whether it's a response (for client) or a
   * request/notification (for server) and dispatches accordingly.
   */
  private setupStdoutReader(session: AcpSession): void {
    const stdout = session.agentProcess.stdout
    if (!stdout) return

    stdout.setEncoding('utf-8')
    stdout.on('data', (chunk: string) => {
      debug(`<-- stdout raw: ${chunk.trimEnd()}`)
      session.stdoutBuffer += chunk
      const lines = session.stdoutBuffer.split('\n')
      session.stdoutBuffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const msg = JSON.parse(line)
          debug(`<-- parsed: ${JSON.stringify(msg)}`)
          // receiveAndSend dispatches to server (if request/notification) or
          // client (if response), and sends back any server response automatically.
          session.rpc.receiveAndSend(msg, undefined, undefined).catch((err) => {
            console.error(`[AcpWorker] receiveAndSend error:`, err)
          })
        } catch {
          debug(`<-- unparseable: ${line}`)
        }
      }
    })
  }
}
