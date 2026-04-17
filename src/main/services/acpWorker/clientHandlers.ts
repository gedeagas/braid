/**
 * ACP Client interface implementation.
 *
 * Handles callbacks from the ACP agent: session updates, permission requests,
 * file operations, and terminal operations. Maps everything to Braid's
 * WorkerEvent system so the coordinator/renderer stay unchanged.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { spawn, type ChildProcess } from 'child_process'
import { dirname, resolve, relative } from 'path'
import type { WorkerEvent } from '../agentTypes'
import { mapSessionUpdate, createTurnState, type TurnState } from './eventMapper'

/**
 * Resolve and validate that a file path stays within the worktree root.
 * Prevents path traversal attacks from ACP agents reading/writing arbitrary files.
 */
function assertWithinWorktree(worktreePath: string, filePath: string): string {
  const resolved = resolve(worktreePath, filePath)
  const rel = relative(worktreePath, resolved)
  if (rel.startsWith('..') || resolve(resolved) !== resolved) {
    throw new Error(`Path traversal denied: "${filePath}" escapes worktree root`)
  }
  return resolved
}

// ---------------------------------------------------------------------------
// Terminal state for one spawned process
// ---------------------------------------------------------------------------
const DEFAULT_OUTPUT_BYTE_LIMIT = 1_048_576 // 1 MiB

interface AcpTerminal {
  process: ChildProcess
  output: string
  truncated: boolean
  outputByteLimit: number
  exitCode: number | null
  exitSignal: string | null
  exited: boolean
  /** Resolves when the process exits. */
  exitPromise: Promise<void>
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface ClientHandlers {
  /** Called for every ACP session/update notification. */
  sessionUpdate(update: Record<string, unknown>): void
  /** Called when the agent requests user permission. Returns ACP RequestPermissionOutcome. */
  requestPermission(options: Record<string, unknown>): Promise<{ outcome: string; optionId?: string }>
  /** Read a text file from the filesystem. ACP supports optional line/limit. */
  readTextFile(params: { path: string; line?: number; limit?: number }): Promise<{ content: string }>
  /** Write a text file to the filesystem. */
  writeTextFile(params: { path: string; content: string }): Promise<null>
  /** Create a terminal (subprocess) and return its ID. */
  createTerminal(params: {
    command: string
    args?: string[]
    cwd?: string | null
    env?: Array<{ name: string; value: string }>
    outputByteLimit?: number | null
  }): Promise<{ terminalId: string }>
  /** Get captured output from a terminal. */
  terminalOutput(params: { terminalId: string }): Promise<{
    output: string
    truncated: boolean
    exitStatus: { exitCode: number | null; signal: string | null } | null
  }>
  /** Wait for a terminal to exit. */
  waitForExit(params: { terminalId: string }): Promise<{
    exitCode: number | null
    signal: string | null
  }>
  /** Kill a terminal process. */
  killTerminal(params: { terminalId: string }): Promise<null>
  /** Release a terminal (cleanup resources). */
  releaseTerminal(params: { terminalId: string }): Promise<null>
  /** Resolve a pending permission request (called from answerToolInput). */
  resolvePermission(permId: string, result: Record<string, unknown>): void
  /** Get the current turn state (for finalization). */
  getTurnState(): TurnState
  /** Reset turn state for a new prompt. */
  resetTurn(): void
  /** Reject all pending permission promises and kill terminals (called on session close/stop). */
  cleanup(): void
}

export function createClientHandlers(
  sessionId: string,
  worktreePath: string,
  emit: (event: WorkerEvent) => void
): ClientHandlers {
  const pendingPermissions = new Map<string, {
    resolve: (value: { outcome: string; optionId?: string }) => void
    options: Array<{ optionId: string; kind: string }>
  }>()
  const terminals = new Map<string, AcpTerminal>()
  let turnState = createTurnState()
  let terminalCounter = 0

  return {
    sessionUpdate(update: Record<string, unknown>): void {
      const events = mapSessionUpdate(sessionId, update, turnState)
      for (const event of events) {
        emit(event)
      }
    },

    async requestPermission(options: Record<string, unknown>): Promise<{ outcome: string; optionId?: string }> {
      const permId = `acp-perm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      const toolCall = options.toolCall as Record<string, unknown> | undefined

      // ACP spec uses `toolName` + `rawInput`; fall back to `name` + `input` for compat
      const toolName =
        (toolCall?.toolName as string) ?? (toolCall?.name as string) ?? (toolCall?.title as string) ?? 'Unknown'
      const toolInput =
        (toolCall?.rawInput as Record<string, unknown>) ?? (toolCall?.input as Record<string, unknown>) ?? {}

      // Extract the agent's option IDs so we can map allow/deny to the correct one
      const agentOptions = (options.options as Array<{ optionId: string; kind: string }>) ?? []

      emit({
        type: 'waiting_input',
        sessionId,
        reason: 'tool_permission',
        toolName,
        toolInput,
        toolUseId: permId,
        displayName: (toolCall?.title as string) ?? undefined,
        description: (options.message as string) ?? undefined
      })

      return new Promise((resolve) => {
        pendingPermissions.set(permId, { resolve, options: agentOptions })
      })
    },

    async readTextFile({ path, line, limit }: { path: string; line?: number; limit?: number }): Promise<{ content: string }> {
      const safePath = assertWithinWorktree(worktreePath, path)
      let content = readFileSync(safePath, 'utf-8')

      // ACP spec: optional line (1-based start) and limit (max lines)
      if (line != null || limit != null) {
        const lines = content.split('\n')
        const startIdx = Math.max(0, (line ?? 1) - 1) // 1-based to 0-based
        const endIdx = limit != null ? startIdx + limit : lines.length
        content = lines.slice(startIdx, endIdx).join('\n')
      }

      return { content }
    },

    async writeTextFile({ path, content }: { path: string; content: string }): Promise<null> {
      const safePath = assertWithinWorktree(worktreePath, path)
      mkdirSync(dirname(safePath), { recursive: true })
      writeFileSync(safePath, content, 'utf-8')
      return null
    },

    async createTerminal(params): Promise<{ terminalId: string }> {
      const terminalId = `term-${++terminalCounter}-${Date.now()}`
      const cwd = params.cwd ?? worktreePath
      const envOverrides: Record<string, string> = {}
      if (params.env) {
        for (const { name, value } of params.env) envOverrides[name] = value
      }

      const proc = spawn(params.command, params.args ?? [], {
        cwd,
        env: { ...process.env, ...envOverrides },
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
      })

      const outputByteLimit = params.outputByteLimit ?? DEFAULT_OUTPUT_BYTE_LIMIT
      const terminal: AcpTerminal = {
        process: proc,
        output: '',
        truncated: false,
        outputByteLimit,
        exitCode: null,
        exitSignal: null,
        exited: false,
        exitPromise: Promise.resolve(),
      }

      // Wire exit promise before anything can happen
      terminal.exitPromise = new Promise<void>((res) => {
        proc.on('exit', (code, signal) => {
          terminal.exitCode = code
          terminal.exitSignal = signal ?? null
          terminal.exited = true
          res()
        })
        proc.on('error', () => {
          terminal.exited = true
          terminal.exitCode = -1
          res()
        })
      })

      // Capture stdout + stderr into a single output buffer
      const appendOutput = (chunk: Buffer | string) => {
        if (terminal.truncated) return
        const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8')
        terminal.output += text
        if (Buffer.byteLength(terminal.output, 'utf-8') > outputByteLimit) {
          terminal.output = terminal.output.slice(0, outputByteLimit)
          terminal.truncated = true
        }
      }
      if (proc.stdout) proc.stdout.on('data', appendOutput)
      if (proc.stderr) proc.stderr.on('data', appendOutput)

      terminals.set(terminalId, terminal)
      return { terminalId }
    },

    async terminalOutput({ terminalId }): Promise<{
      output: string
      truncated: boolean
      exitStatus: { exitCode: number | null; signal: string | null } | null
    }> {
      const term = terminals.get(terminalId)
      if (!term) throw new Error(`Terminal not found: ${terminalId}`)
      return {
        output: term.output,
        truncated: term.truncated,
        exitStatus: term.exited ? { exitCode: term.exitCode, signal: term.exitSignal } : null,
      }
    },

    async waitForExit({ terminalId }): Promise<{ exitCode: number | null; signal: string | null }> {
      const term = terminals.get(terminalId)
      if (!term) throw new Error(`Terminal not found: ${terminalId}`)
      await term.exitPromise
      return { exitCode: term.exitCode, signal: term.exitSignal }
    },

    async killTerminal({ terminalId }): Promise<null> {
      const term = terminals.get(terminalId)
      if (!term) throw new Error(`Terminal not found: ${terminalId}`)
      if (!term.exited) term.process.kill('SIGTERM')
      return null
    },

    async releaseTerminal({ terminalId }): Promise<null> {
      const term = terminals.get(terminalId)
      if (term) {
        if (!term.exited) term.process.kill('SIGKILL')
        terminals.delete(terminalId)
      }
      return null
    },

    resolvePermission(permId: string, result: Record<string, unknown>): void {
      const pending = pendingPermissions.get(permId)
      if (!pending) return
      pendingPermissions.delete(permId)

      const behavior = (result.behavior as string) ?? 'allow'
      if (behavior === 'deny') {
        // Find the agent's reject option, fall back to 'cancelled' outcome
        const rejectOpt = pending.options.find((o) => o.kind === 'reject_once')
        if (rejectOpt) {
          pending.resolve({ outcome: 'selected', optionId: rejectOpt.optionId })
        } else {
          pending.resolve({ outcome: 'cancelled' })
        }
      } else {
        // Find the agent's allow option matching the behavior kind
        const allowOpt =
          pending.options.find((o) => o.kind === 'allow_once') ??
          pending.options.find((o) => o.kind === 'allow_always') ??
          pending.options.find((o) => o.kind.startsWith('allow'))
        const optionId = allowOpt?.optionId ?? 'allow_once'
        pending.resolve({ outcome: 'selected', optionId })
      }
    },

    getTurnState(): TurnState {
      return turnState
    },

    resetTurn(): void {
      turnState = createTurnState()
    },

    cleanup(): void {
      // Resolve all pending permission promises as "cancelled" so they don't hang forever
      for (const [, pending] of pendingPermissions) {
        pending.resolve({ outcome: 'cancelled' })
      }
      pendingPermissions.clear()

      // Kill all running terminals
      for (const [id, term] of terminals) {
        if (!term.exited) term.process.kill('SIGKILL')
        terminals.delete(id)
      }
    }
  }
}
