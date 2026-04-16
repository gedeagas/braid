import { BrowserWindow, Notification, app, utilityProcess } from 'electron'
import path from 'path'
import crypto from 'crypto'
import { execFile } from 'child_process'
import { mainSettings } from '../ipc'
import type { WorkerEvent, AgentSettings, AgentBackend, SlashCommand } from './agentTypes'
import type { WorkerCommand, WorkerResult } from './agentProcessTypes'
import { acpConfigService } from './acpConfig'
import { ptyService } from './pty'
import { enrichedEnv } from '../lib/enrichedEnv'

/** Metadata cached in the coordinator (no cross-process call needed). */
interface SessionMeta { sessionName: string; cwd: string; branch: string; projectName: string; backend: AgentBackend }

/** Resolve the current git branch for a worktree path. */
function resolveGitBranch(cwd: string): Promise<string> {
  return new Promise((resolve) => {
    execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeout: 3000 }, (err, stdout) => {
      resolve(err ? '' : stdout.trim())
    })
  })
}

const ENTRY_PATH = path.join(__dirname, 'agentProcess.js')
const ACP_ENTRY_PATH = path.join(__dirname, 'acpProcess.js')
const EPHEMERAL_TIMEOUT_MS = 60_000


/**
 * AgentCoordinator — manages UtilityProcess children that each run AgentWorker.
 * One process per active session.  Ephemeral processes for stateless ops.
 */
class AgentCoordinator {
  private sessionProcesses = new Map<string, Electron.UtilityProcess>()
  private sessionMeta = new Map<string, SessionMeta>()
  private pendingRequests = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private slashCommandsCache = new Map<string, SlashCommand[]>()
  /** Set during app quit to suppress spurious "process exited" errors. */
  private shuttingDown = false

  constructor() {
    app.on('before-quit', () => {
      this.shuttingDown = true
      const children = [...this.sessionProcesses.values()]
      this.sessionProcesses.clear()
      this.sessionMeta.clear()
      for (const child of children) child.kill()
    })
  }

  // ── Process management ──────────────────────────────────────────────

  private spawnSessionProcess(sessionId: string, backend?: AgentBackend): Electron.UtilityProcess {
    const entryPath = backend?.type === 'acp' ? ACP_ENTRY_PATH : ENTRY_PATH
    const serviceName = backend?.type === 'acp'
      ? `acp-${sessionId.slice(-6)}`
      : `claude-${sessionId.slice(-6)}`
    const child = utilityProcess.fork(entryPath, [], {
      serviceName,
      env: enrichedEnv(),
    })

    child.on('message', (msg: WorkerEvent) => {
      this.handleWorkerEvent(msg)
    })

    child.on('exit', (code: number) => {
      if (this.shuttingDown) return
      if (this.sessionProcesses.has(sessionId)) {
        this.sessionProcesses.delete(sessionId)
        this.sendEvent(sessionId, { type: 'error', message: `Session process exited (code ${code})` })
        this.maybeNotify(sessionId, 'error', `Session process exited unexpectedly (code ${code})`)
      }
    })

    this.sessionProcesses.set(sessionId, child)
    return child
  }

  private postCommand(sessionId: string, cmd: WorkerCommand, backend?: AgentBackend): Electron.UtilityProcess {
    let child = this.sessionProcesses.get(sessionId)
    if (!child || child.pid === undefined) {
      child = this.spawnSessionProcess(sessionId, backend)
    }
    child.postMessage(cmd)
    return child
  }

  private spawnEphemeral(
    cmd: WorkerCommand & { requestId: string }
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const { requestId } = cmd
      const child = utilityProcess.fork(ENTRY_PATH, [], {
        serviceName: `claude-ephemeral`,
        env: enrichedEnv(),
      })

      const timer = setTimeout(() => {
        cleanup()
        child.kill()
        reject(new Error('Ephemeral process timed out'))
      }, EPHEMERAL_TIMEOUT_MS)

      const cleanup = (): void => {
        clearTimeout(timer)
        this.pendingRequests.delete(requestId)
      }

      this.pendingRequests.set(requestId, { resolve, reject })

      child.on('message', (msg: WorkerResult) => {
        if (msg.type === 'result' && msg.requestId === requestId) {
          cleanup()
          child.kill()
          resolve(msg.value)
        } else if (msg.type === 'result_error' && msg.requestId === requestId) {
          cleanup()
          child.kill()
          reject(new Error(msg.message))
        }
      })

      child.on('exit', () => {
        if (this.pendingRequests.has(requestId)) {
          cleanup()
          reject(new Error('Ephemeral process exited unexpectedly'))
        }
      })

      child.postMessage(cmd)
    })
  }

  // ── Worker event routing ────────────────────────────────────────────

  private handleWorkerEvent(event: WorkerEvent): void {
    switch (event.type) {
      case 'sdk_message':
        this.sendEvent(event.sessionId, event.message)
        break
      case 'init':
        this.sendEvent(event.sessionId, {
          type: 'init',
          sdkSessionId: event.sdkSessionId,
          slashCommands: event.slashCommands
        })
        break
      case 'slash_commands':
        this.sendEvent(event.sessionId, { type: 'slashCommands', commands: event.commands })
        break
      case 'done':
        this.sendEvent(event.sessionId, { type: 'done' })
        break
      case 'error':
        this.sendEvent(event.sessionId, { type: 'error', message: event.message, errorKind: event.errorKind, authType: event.authType })
        this.maybeNotify(event.sessionId, 'error', event.message)
        break
      case 'waiting_input':
        if (event.reason === 'tool_permission') {
          this.sendEvent(event.sessionId, {
            type: 'waiting_input',
            reason: event.reason,
            toolName: event.toolName,
            toolInput: event.toolInput,
            toolUseId: event.toolUseId,
            displayName: event.displayName,
            description: event.description,
          })
        } else if (event.reason === 'elicitation') {
          this.sendEvent(event.sessionId, {
            type: 'waiting_input',
            reason: event.reason,
            serverName: event.serverName,
            message: event.message,
            mode: event.mode,
            url: event.url,
            elicitationId: event.elicitationId,
            requestedSchema: event.requestedSchema,
          })
        } else {
          this.sendEvent(event.sessionId, { type: 'waiting_input', reason: event.reason })
        }
        this.maybeNotify(event.sessionId, 'waiting_input', undefined,
          event.reason === 'tool_permission' || event.reason === 'elicitation' ? undefined : event.reason)
        break
      case 'elicitation_complete':
        this.sendEvent(event.sessionId, { type: 'elicitation_complete', serverName: event.serverName })
        break
      case 'braid_action':
        this.handleBraidAction(event)
        break
    }
  }

  private handleBraidAction(event: Extract<WorkerEvent, { type: 'braid_action' }>): void {
    switch (event.action) {
      case 'worktree_created':
        this.sendEvent(event.sessionId, { type: 'braid_worktree_created', payload: event.payload })
        break
      case 'create_session':
        this.sendEvent(event.sessionId, { type: 'braid_session_created', payload: event.payload })
        break
      case 'data_request':
        this.handleBraidDataRequest(event.sessionId, event.payload)
        break
    }
  }

  private handleBraidDataRequest(sessionId: string, payload: Record<string, unknown>): void {
    const { requestId, dataType, ...params } = payload as { requestId: string; dataType: string; [key: string]: unknown }
    if (!requestId || !dataType) return
    const child = this.sessionProcesses.get(sessionId)
    if (!child) return

    try {
      let value: unknown
      switch (dataType) {
        case 'read_terminal':
          value = ptyService.readTerminalOutput(params.worktreePath as string)
          break
        default:
          child.postMessage({ type: 'braidDataError', requestId, message: `Unknown data type: ${dataType}` } satisfies WorkerCommand)
          return
      }
      child.postMessage({ type: 'braidDataResponse', requestId, value } satisfies WorkerCommand)
    } catch (err) {
      child.postMessage({
        type: 'braidDataError',
        requestId,
        message: err instanceof Error ? err.message : String(err),
      } satisfies WorkerCommand)
    }
  }

  // ── Settings bridge ─────────────────────────────────────────────────

  private getAgentSettings(): AgentSettings {
    return {
      apiKey: mainSettings.apiKey,
      systemPromptSuffix: mainSettings.systemPromptSuffix,
      claudeCodeExecutablePath: mainSettings.claudeCodeExecutablePath,
      bypassPermissions: mainSettings.bypassPermissions,
    }
  }

  // ── Public API (identical signatures to Step 1) ─────────────────────

  updateSessionName(sessionId: string, name: string): void {
    const meta = this.sessionMeta.get(sessionId)
    if (meta) meta.sessionName = name
    const child = this.sessionProcesses.get(sessionId)
    if (child) child.postMessage({ type: 'updateSessionName', sessionId, name } satisfies WorkerCommand)
  }

  notify(
    sessionId: string,
    type: 'done' | 'error' | 'waiting_input',
    sessionName?: string,
    errorMessage?: string,
    reason?: 'question' | 'plan_approval'
  ): void {
    if (sessionName) {
      const meta = this.sessionMeta.get(sessionId)
      if (meta) meta.sessionName = sessionName
    }
    this.maybeNotify(sessionId, type, errorMessage, reason)
  }

  answerToolInput(sessionId: string, result: Record<string, unknown>): void {
    const child = this.sessionProcesses.get(sessionId)
    if (child) child.postMessage({ type: 'answerToolInput', sessionId, result } satisfies WorkerCommand)
  }

  answerElicitation(sessionId: string, result: { action: 'accept' | 'decline' | 'cancel'; content?: Record<string, unknown> }): void {
    const child = this.sessionProcesses.get(sessionId)
    if (child) child.postMessage({ type: 'answerElicitation', sessionId, result } satisfies WorkerCommand)
  }

  async startSession(
    sessionId: string,
    worktreeId: string,
    worktreePath: string,
    prompt: string,
    model: string,
    thinking: boolean,
    planMode: boolean,
    sessionName: string = 'New Chat',
    images?: string[],
    additionalDirectories?: string[],
    linkedWorktreeContext?: string,
    connectedDeviceId?: string,
    mobileFramework?: string,
    backend?: AgentBackend
  ): Promise<void> {
    const branch = await resolveGitBranch(worktreePath)
    const projectName = path.basename(path.dirname(worktreePath))
    this.sessionMeta.set(sessionId, { sessionName, cwd: worktreePath, branch, projectName, backend: backend ?? { type: 'claude-sdk' } })

    // Resolve ACP agent config in the main process (which can use Electron APIs)
    // and pass it to the UtilityProcess worker to avoid Electron imports there.
    const agentConfig = backend?.type === 'acp' ? acpConfigService.get(backend.agentId) : undefined

    this.postCommand(sessionId, {
      type: 'startSession', sessionId, worktreeId, projectName,
      worktreePath, prompt, model, thinking,
      planMode, sessionName, settings: this.getAgentSettings(), images,
      additionalDirectories, linkedWorktreeContext, connectedDeviceId, mobileFramework,
      backend, agentConfig
    }, backend)
  }

  async sendMessage(
    sessionId: string,
    message: string,
    sdkSessionId: string,
    cwd: string,
    model: string,
    planMode: boolean,
    sessionName: string = 'New Chat',
    images?: string[],
    additionalDirectories?: string[],
    linkedWorktreeContext?: string,
    connectedDeviceId?: string,
    mobileFramework?: string
  ): Promise<void> {
    const meta = this.sessionMeta.get(sessionId)
    if (meta) {
      meta.sessionName = sessionName
      // Re-resolve branch if cwd changed (e.g. branch rename)
      if (meta.cwd !== cwd) {
        meta.cwd = cwd
        meta.branch = await resolveGitBranch(cwd)
      }
    } else {
      const branch = await resolveGitBranch(cwd)
      const projectName = path.basename(path.dirname(cwd))
      this.sessionMeta.set(sessionId, { sessionName, cwd, branch, projectName, backend: { type: 'claude-sdk' } })
    }
    const storedBackend = this.sessionMeta.get(sessionId)?.backend
    this.postCommand(sessionId, {
      type: 'sendMessage', sessionId, message, sdkSessionId, cwd, model,
      planMode, sessionName, settings: this.getAgentSettings(), images,
      additionalDirectories, linkedWorktreeContext, connectedDeviceId, mobileFramework
    }, storedBackend)
  }

  async stopSession(sessionId: string): Promise<void> {
    const child = this.sessionProcesses.get(sessionId)
    if (child) child.postMessage({ type: 'stopSession', sessionId } satisfies WorkerCommand)
  }

  closeSession(sessionId: string): void {
    const child = this.sessionProcesses.get(sessionId)
    if (child) {
      child.postMessage({ type: 'closeSession', sessionId } satisfies WorkerCommand)
      // Give the worker a moment to clean up, then kill
      setTimeout(() => child.kill(), 500)
    }
    this.sessionProcesses.delete(sessionId)
    this.sessionMeta.delete(sessionId)
  }

  async generateCommitMessage(worktreePath: string): Promise<string> {
    const result = await this.spawnEphemeral({
      type: 'generateCommitMessage',
      requestId: crypto.randomUUID(),
      worktreePath,
      settings: this.getAgentSettings()
    })
    return result as string
  }

  async generateSessionTitle(
    userMessage: string,
    assistantSummary: string,
    currentTitle?: string
  ): Promise<string> {
    const result = await this.spawnEphemeral({
      type: 'generateSessionTitle',
      requestId: crypto.randomUUID(),
      userMessage,
      assistantSummary,
      settings: this.getAgentSettings(),
      currentTitle
    })
    return result as string
  }

  async getSlashCommands(cwd: string): Promise<SlashCommand[]> {
    const cached = this.slashCommandsCache.get(cwd)
    if (cached) return cached
    const result = await this.spawnEphemeral({
      type: 'getSlashCommands',
      requestId: crypto.randomUUID(),
      cwd
    })
    const commands = result as SlashCommand[]
    this.slashCommandsCache.set(cwd, commands)
    return commands
  }

  // ── Electron-only private methods ───────────────────────────────────

  private getWindow(): BrowserWindow | null {
    const windows = BrowserWindow.getAllWindows()
    return windows[0] ?? null
  }

  private sendEvent(sessionId: string, event: unknown): void {
    const win = this.getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('agent:event', { sessionId, event })
    }
  }

  private maybeNotify(
    sessionId: string,
    type: 'done' | 'error' | 'waiting_input',
    errorMessage?: string,
    reason?: 'question' | 'plan_approval'
  ): void {
    if (type === 'done' && !mainSettings.notifyOnDone) return
    if (type === 'error' && !mainSettings.notifyOnError) return
    if (type === 'waiting_input' && !mainSettings.notifyOnWaitingInput) return

    const win = this.getWindow()
    if (win && !win.isDestroyed() && win.isFocused()) return

    if (process.platform === 'darwin' && app.dock) {
      app.dock.bounce(type === 'waiting_input' ? 'critical' : 'informational')
    }
    if (win && !win.isDestroyed()) {
      win.flashFrame(true)
    }

    const meta = this.sessionMeta.get(sessionId)
    const rawName = meta?.sessionName ?? ''
    const branch = meta?.branch ?? ''
    const sessionName = rawName && rawName !== 'New Chat' ? rawName : (branch || 'Chat')

    // Include project name when sessions span 2+ distinct projects
    const uniqueProjects = new Set(
      Array.from(this.sessionMeta.values()).map((m) => m.projectName).filter(Boolean)
    )
    const projectPrefix = uniqueProjects.size >= 2 && meta?.projectName
      ? `${meta.projectName} / `
      : ''
    const label = rawName && rawName !== 'New Chat' && branch
      ? `${projectPrefix}${rawName} — ${branch}`
      : `${projectPrefix}${sessionName}`

    const waitingTitle = reason === 'plan_approval' ? 'Plan ready for review' : 'Agent has a question'
    const waitingBody = reason === 'plan_approval'
      ? `${label} — review and approve the plan`
      : `${label} — reply to continue`

    const titles: Record<string, string> = {
      done: 'Task complete',
      error: 'Agent stopped — needs help',
      waiting_input: waitingTitle
    }
    const bodies: Record<string, string> = {
      done: `${label} — finished successfully`,
      error: errorMessage ? `${label}\n${errorMessage}` : label,
      waiting_input: waitingBody
    }
    const notification = new Notification({
      title: titles[type],
      body: bodies[type],
      silent: !mainSettings.notificationSound
    })

    notification.once('click', () => {
      const w = this.getWindow()
      if (w && !w.isDestroyed()) {
        w.show()
        w.focus()
      }
    })

    notification.show()
  }
}

export const agentService = new AgentCoordinator()
