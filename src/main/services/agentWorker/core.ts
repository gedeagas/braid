/**
 * AgentWorker — SDK orchestration layer.
 *
 * ⚠️  DO NOT import from 'electron' or '../ipc' (mainSettings) here.
 * This file must stay free of Electron dependencies so it remains
 * unit-testable without an Electron runtime.  All platform/IPC
 * concerns belong in agent.ts (AgentCoordinator).
 */

import { generateCommitMessage, generateSessionTitle } from '../agentGenerate'
import {
  loadPlugins,
  BRAID_SYSTEM_PROMPT,
  MOBILE_SYSTEM_PROMPT,
  frameworkPrompt,
  buildUserContent
} from '../agentUtils'
import { getCliPath } from '../claudePath'
import { prepareMcpServers } from './mcp'
import type { BraidAction } from '../braidMcp'
import { createCanUseTool, fetchSlashCommands } from './tools'
import { classifyError, classifyAuthType } from './errorClassifier'
import type { SessionState, SlashCommand, WorkerEvent, AgentSettings } from '../agentTypes'

export class AgentWorker {
  private sessions = new Map<string, SessionState>()
  private pendingUserInput = new Map<string, { resolve: (result: Record<string, unknown>) => void }>()
  private pendingElicitation = new Map<string, { resolve: (result: { action: 'accept' | 'decline' | 'cancel'; content?: Record<string, unknown> }) => void }>()
  private slashCommandsCache = new Map<string, SlashCommand[]>()
  private slashCommandsInflight = new Map<string, Promise<SlashCommand[]>>()
  private emit: (event: WorkerEvent) => void
  /** Cached user-configured CLI path — updated whenever settings arrive. */
  private userCliPath = ''

  constructor(emit: (event: WorkerEvent) => void) {
    this.emit = emit
  }

  getSession(sessionId: string): SessionState | undefined {
    return this.sessions.get(sessionId)
  }

  /** Import the SDK query function (cached after first load). */
  private async importSdk(): Promise<typeof import('@anthropic-ai/claude-agent-sdk').query> {
    const sdk = await import('@anthropic-ai/claude-agent-sdk')
    return sdk.query
  }

  /** Create an onElicitation callback for MCP server auth/input requests. */
  private createOnElicitation(sessionId: string): (request: { serverName: string; message: string; mode?: 'form' | 'url'; url?: string; elicitationId?: string; requestedSchema?: Record<string, unknown> }, options: { signal: AbortSignal }) => Promise<{ action: 'accept' | 'decline' | 'cancel'; content?: Record<string, unknown> }> {
    return (request, options) => {
      this.log(sessionId, `onElicitation: ${request.serverName} mode=${request.mode}`)
      this.emit({
        type: 'waiting_input',
        sessionId,
        reason: 'elicitation',
        serverName: request.serverName,
        message: request.message,
        mode: request.mode,
        url: request.url,
        elicitationId: request.elicitationId,
        requestedSchema: request.requestedSchema,
      })
      return new Promise((resolve, reject) => {
        if (options.signal.aborted) { reject(new Error('Aborted')); return }
        this.pendingElicitation.set(sessionId, { resolve })
        options.signal.addEventListener('abort', () => {
          if (this.pendingElicitation.has(sessionId)) {
            this.pendingElicitation.delete(sessionId)
            reject(new Error('Aborted'))
          }
        }, { once: true })
      })
    }
  }

  updateSessionName(sessionId: string, name: string): void {
    const state = this.sessions.get(sessionId)
    if (state) state.sessionName = name
  }

  answerToolInput(sessionId: string, result: Record<string, unknown>): void {
    this.log(sessionId, 'answerToolInput', result.behavior)
    const pending = this.pendingUserInput.get(sessionId)
    if (!pending) {
      this.log(sessionId, 'No pending user input to resolve')
      return
    }
    this.pendingUserInput.delete(sessionId)
    pending.resolve(result)
  }

  answerElicitation(sessionId: string, result: { action: 'accept' | 'decline' | 'cancel'; content?: Record<string, unknown> }): void {
    this.log(sessionId, 'answerElicitation', result.action)
    const pending = this.pendingElicitation.get(sessionId)
    if (!pending) {
      this.log(sessionId, 'No pending elicitation to resolve')
      return
    }
    this.pendingElicitation.delete(sessionId)
    pending.resolve(result)
  }

  async startSession(
    sessionId: string,
    worktreeId: string,
    projectName: string,
    worktreePath: string,
    prompt: string,
    model: string,
    thinking: boolean,
    extendedContext: boolean,
    planMode: boolean,
    sessionName: string = 'New Chat',
    settings: AgentSettings,
    images?: string[],
    additionalDirectories?: string[],
    linkedWorktreeContext?: string,
    connectedDeviceId?: string,
    mobileFramework?: string
  ): Promise<void> {
    this.log(sessionId, 'startSession', { worktreePath, model, thinking, extendedContext, planMode, promptLen: prompt.length, imageCount: images?.length ?? 0, linkedDirs: additionalDirectories?.length ?? 0 })
    console.log(`[Braid] startSession - model: ${model} | thinking: ${thinking} | extendedContext: ${extendedContext} | planMode: ${planMode}`)

    let queryFn: typeof import('@anthropic-ai/claude-agent-sdk').query
    try {
      queryFn = await this.importSdk()
    } catch (err) {
      this.emit({ type: 'error', sessionId, message: `SDK import failed: ${err}` })
      return
    }

    delete process.env.CLAUDECODE
    const abortController = new AbortController()
    const state: SessionState = { abortController, cwd: worktreePath, model, extendedContext, sessionName, additionalDirectories, linkedWorktreeContext, initialLinkedContext: linkedWorktreeContext, connectedDeviceId, mobileFramework, worktreeId, projectName }
    this.sessions.set(sessionId, state)
    this.applyApiKey(settings)

    try {
      this.log(sessionId, 'Creating query...')

      // Inject user-configured, Braid, and mobile-device MCP servers
      const braidEmit = (e: BraidAction): void => { this.emit({ ...e, sessionId }) }
      const mcpServers = await prepareMcpServers(worktreeId, worktreePath, projectName, braidEmit, connectedDeviceId, mobileFramework)
      if (mcpServers) this.log(sessionId, `Injecting MCP servers: ${Object.keys(mcpServers).join(', ')}`)

      const hasImages = images && images.length > 0
      const promptParam = hasImages
        ? (async function* (content: Array<Record<string, unknown>>) {
            yield { type: 'user', message: { role: 'user', content } }
          })(buildUserContent(prompt, images))
        : prompt
      const linkedSuffix = linkedWorktreeContext
        ? `\n\nLinked worktrees (you have full read/write access):\n${linkedWorktreeContext}`
        : ''
      const mobileSuffix = connectedDeviceId ? `\n\n${MOBILE_SYSTEM_PROMPT}${frameworkPrompt(mobileFramework)}` : ''
      const systemAppend = settings.systemPromptSuffix
        ? `${BRAID_SYSTEM_PROMPT}\n\n${settings.systemPromptSuffix}${linkedSuffix}${mobileSuffix}`
        : `${BRAID_SYSTEM_PROMPT}${linkedSuffix}${mobileSuffix}`

      // Enable 1M context window beta for compatible older models (Sonnet 4/4.5)
      const needsBeta = extendedContext && !model.includes('opus') && !model.includes('mythos') && !(model.includes('sonnet') && model.includes('4-6')) && model.includes('sonnet')
      const betas = needsBeta ? ['context-1m-2025-08-07' as const] : undefined

      const q = queryFn({
        prompt: promptParam as Parameters<typeof queryFn>[0]['prompt'],
        options: {
          cwd: worktreePath,
          additionalDirectories: additionalDirectories?.length ? additionalDirectories : undefined,
          model,
          canUseTool: createCanUseTool(sessionId, worktreePath, settings.bypassPermissions, this.emit, this.pendingUserInput, this.log.bind(this)),
          onElicitation: this.createOnElicitation(sessionId),
          includePartialMessages: true,
          maxThinkingTokens: thinking ? undefined : 0,
          permissionMode: planMode ? 'plan' : undefined,
          settingSources: ['user', 'project', 'local'],
          plugins: loadPlugins(worktreePath),
          abortController,
          systemPrompt: { type: 'preset', preset: 'claude_code', append: systemAppend },
          stderr: (data: string) => { this.log(sessionId, 'stderr:', data.trim()) },
          ...(betas ? { betas } : {}),
          ...(mcpServers ? { mcpServers } : {}),
          ...(getCliPath(this.userCliPath) ? { pathToClaudeCodeExecutable: getCliPath(this.userCliPath) } : {}),
        } as Parameters<typeof queryFn>[0]['options']
      })

      this.log(sessionId, 'Iterating messages...')
      let msgCount = 0
      for await (const message of q) {
        msgCount++
        if (abortController.signal.aborted) break
        this.log(sessionId, `msg #${msgCount} type=${message.type}`, 'subtype' in message ? `subtype=${(message as Record<string, unknown>).subtype}` : '')

        // Auto-resolve pending elicitation when MCP server confirms OAuth complete
        if (message.type === 'system' && 'subtype' in message && (message as Record<string, unknown>).subtype === 'elicitation_complete') {
          const msg = message as Record<string, unknown>
          const serverName = (msg.mcp_server_name as string) ?? ''
          this.log(sessionId, 'elicitation_complete', serverName)
          const pending = this.pendingElicitation.get(sessionId)
          if (pending) {
            this.pendingElicitation.delete(sessionId)
            pending.resolve({ action: 'accept' })
          }
          this.emit({ type: 'elicitation_complete', sessionId, serverName })
          continue
        }

        if (message.type === 'system' && 'subtype' in message && message.subtype === 'init') {
          state.sdkSessionId = message.session_id
          this.log(sessionId, 'Got SDK session_id:', message.session_id)
          const msg = message as Record<string, unknown>
          const builtinNames = (msg.slash_commands as string[]) ?? []
          const skillNames = (msg.skills as string[]) ?? []
          const skillNameSet = new Set(skillNames)

          this.emit({
            type: 'init',
            sessionId,
            sdkSessionId: message.session_id,
            slashCommands: [
              ...builtinNames.map((name: string) => ({ name, source: 'builtin' as const })),
              ...skillNames.map((name: string) => ({ name, source: 'skill' as const }))
            ]
          })

          q.supportedCommands()
            .then((richCmds) => {
              this.emit({
                type: 'slash_commands',
                sessionId,
                commands: richCmds.map((cmd) => ({
                  name: cmd.name,
                  description: cmd.description ?? '',
                  argumentHint: cmd.argumentHint ?? undefined,
                  source: skillNameSet.has(cmd.name) ? ('skill' as const) : ('builtin' as const)
                }))
              })
            })
            .catch((err) => { this.log(sessionId, 'supportedCommands() failed:', err) })
          continue
        }

        this.emit({ type: 'sdk_message', sessionId, message })
      }

      this.log(sessionId, `Done. ${msgCount} messages total. sdkSessionId=${state.sdkSessionId}`)
      this.emit({ type: 'done', sessionId })
    } catch (err: unknown) {
      if (abortController.signal.aborted) {
        this.log(sessionId, 'Session stopped by user')
        this.emit({ type: 'done', sessionId })
        return
      }
      const message = err instanceof Error ? err.message : String(err)
      this.log(sessionId, 'ERROR:', message)
      if (err instanceof Error && err.stack) this.log(sessionId, 'Stack:', err.stack)
      const errorKind = classifyError(message)
      this.emit({
        type: 'error', sessionId, message, errorKind,
        ...(errorKind === 'auth' ? { authType: classifyAuthType(message) } : {})
      })
    }
  }

  async sendMessage(
    sessionId: string,
    message: string,
    sdkSessionId: string,
    cwd: string,
    model: string,
    extendedContext: boolean,
    planMode: boolean,
    sessionName: string = 'New Chat',
    settings: AgentSettings,
    images?: string[],
    additionalDirectories?: string[],
    linkedWorktreeContext?: string,
    connectedDeviceId?: string,
    mobileFramework?: string
  ): Promise<void> {
    let state = this.sessions.get(sessionId)
    if (!state) {
      this.log(sessionId, 'Recovering lost session state from renderer')
      state = { sdkSessionId, cwd, model, extendedContext, sessionName, additionalDirectories, linkedWorktreeContext, initialLinkedContext: undefined, connectedDeviceId, mobileFramework }
      this.sessions.set(sessionId, state)
    } else {
      state.sessionName = sessionName
      state.model = model
      state.extendedContext = extendedContext
      state.additionalDirectories = additionalDirectories
      state.linkedWorktreeContext = linkedWorktreeContext
      state.connectedDeviceId = connectedDeviceId
      state.mobileFramework = mobileFramework
    }

    const resumeId = state.sdkSessionId ?? sdkSessionId
    this.log(sessionId, 'sendMessage', { sdkSessionId: resumeId, cwd: state.cwd, planMode, messageLen: message.length })
    console.log(`[Braid] sendMessage — model: ${model} | planMode: ${planMode}`)

    if (!resumeId) {
      const err = 'No active SDK session to resume'
      this.log(sessionId, err)
      this.emit({ type: 'error', sessionId, message: err })
      return
    }

    let queryFn: typeof import('@anthropic-ai/claude-agent-sdk').query
    try {
      queryFn = await this.importSdk()
    } catch (err) {
      this.emit({ type: 'error', sessionId, message: `SDK import failed: ${err}` })
      return
    }

    delete process.env.CLAUDECODE
    this.applyApiKey(settings)
    const abortController = new AbortController()
    state.abortController = abortController

    try {
      // Re-inject all MCP servers on resume (user-configured + Braid + mobile)
      const braidEmit = (e: BraidAction): void => { this.emit({ ...e, sessionId }) }
      const mcpServers = await prepareMcpServers(state.worktreeId ?? '', state.cwd, state.projectName ?? '', braidEmit, state.connectedDeviceId, state.mobileFramework)

      this.log(sessionId, 'Creating resume query with session:', resumeId)

      // If linked worktree context changed since session start, prepend it to
      // the user message so the agent learns about newly linked worktrees.
      // The system prompt can't be changed on resume, so we inject inline.
      let effectiveMessage = message
      const currentLinked = state.linkedWorktreeContext
      const previousLinked = state.initialLinkedContext
      if (currentLinked !== previousLinked) {
        let prefix: string
        if (currentLinked && !previousLinked) {
          prefix = `[Linked worktrees — you now have full read/write access to these additional directories]\n${currentLinked}\n\n`
        } else if (!currentLinked && previousLinked) {
          prefix = `[Linked worktrees removed — the previously linked directories are no longer available]\n\n`
        } else if (currentLinked && previousLinked) {
          prefix = `[Linked worktrees updated — you have full read/write access to these directories]\n${currentLinked}\n\n`
        } else {
          prefix = ''
        }
        if (prefix) effectiveMessage = prefix + message
        state.initialLinkedContext = currentLinked
      }

      const hasImages = images && images.length > 0
      const promptParam = hasImages
        ? (async function* (content: Array<Record<string, unknown>>) {
            yield { type: 'user', message: { role: 'user', content } }
          })(buildUserContent(effectiveMessage, images))
        : effectiveMessage
      // Enable 1M context window beta for compatible older models (Sonnet 4/4.5)
      const needsBeta = state.extendedContext && !state.model.includes('opus') && !state.model.includes('mythos') && !(state.model.includes('sonnet') && state.model.includes('4-6')) && state.model.includes('sonnet')
      const betas = needsBeta ? ['context-1m-2025-08-07' as const] : undefined

      const q = queryFn({
        prompt: promptParam as Parameters<typeof queryFn>[0]['prompt'],
        options: {
          cwd: state.cwd,
          additionalDirectories: state.additionalDirectories?.length ? state.additionalDirectories : undefined,
          model: state.model,
          resume: resumeId,
          canUseTool: createCanUseTool(sessionId, state.cwd, settings.bypassPermissions, this.emit, this.pendingUserInput, this.log.bind(this)),
          onElicitation: this.createOnElicitation(sessionId),
          includePartialMessages: true,
          permissionMode: planMode ? 'plan' : undefined,
          settingSources: ['user', 'project', 'local'],
          plugins: loadPlugins(state.cwd),
          abortController,
          stderr: (data: string) => { this.log(sessionId, 'resume stderr:', data.trim()) },
          ...(betas ? { betas } : {}),
          ...(mcpServers ? { mcpServers } : {}),
          ...(getCliPath(this.userCliPath) ? { pathToClaudeCodeExecutable: getCliPath(this.userCliPath) } : {}),
        } as Parameters<typeof queryFn>[0]['options']
      })

      this.log(sessionId, 'Iterating resume messages...')
      let msgCount = 0
      for await (const msg of q) {
        msgCount++
        if (abortController.signal.aborted) break
        this.log(sessionId, `resume msg #${msgCount} type=${msg.type}`)

        // Auto-resolve pending elicitation when MCP server confirms OAuth complete
        if (msg.type === 'system' && 'subtype' in msg && (msg as Record<string, unknown>).subtype === 'elicitation_complete') {
          const raw = msg as Record<string, unknown>
          const serverName = (raw.mcp_server_name as string) ?? ''
          this.log(sessionId, 'elicitation_complete', serverName)
          const pending = this.pendingElicitation.get(sessionId)
          if (pending) {
            this.pendingElicitation.delete(sessionId)
            pending.resolve({ action: 'accept' })
          }
          this.emit({ type: 'elicitation_complete', sessionId, serverName })
          continue
        }

        this.emit({ type: 'sdk_message', sessionId, message: msg })
      }

      this.log(sessionId, `Resume done. ${msgCount} messages.`)
      this.emit({ type: 'done', sessionId })
    } catch (err: unknown) {
      if (abortController.signal.aborted) {
        this.log(sessionId, 'Resume stopped by user')
        this.emit({ type: 'done', sessionId })
        return
      }
      const errMsg = err instanceof Error ? err.message : String(err)
      this.log(sessionId, 'RESUME ERROR:', errMsg)
      if (err instanceof Error && err.stack) this.log(sessionId, 'Stack:', err.stack)

      if (errMsg.includes('text content blocks must be non-empty')) {
        this.log(sessionId, 'Corrupt session history detected - falling back to fresh session')
        state.sdkSessionId = undefined
        await this.startSession(sessionId, state.worktreeId ?? '', state.projectName ?? '', state.cwd, message, state.model, false, state.extendedContext ?? false, false, state.sessionName, settings, images, state.additionalDirectories, state.linkedWorktreeContext, state.connectedDeviceId, state.mobileFramework)
        return
      }

      if (errMsg.includes('No conversation found with session ID')) {
        this.log(sessionId, 'Stale session ID detected (conversation was never committed) - falling back to fresh session')
        state.sdkSessionId = undefined
        await this.startSession(sessionId, state.worktreeId ?? '', state.projectName ?? '', state.cwd, message, state.model, false, state.extendedContext ?? false, false, state.sessionName, settings, images, state.additionalDirectories, state.linkedWorktreeContext, state.connectedDeviceId, state.mobileFramework)
        return
      }

      const errorKind = classifyError(errMsg)
      this.emit({
        type: 'error', sessionId, message: errMsg, errorKind,
        ...(errorKind === 'auth' ? { authType: classifyAuthType(errMsg) } : {})
      })
    }
  }

  async stopSession(sessionId: string): Promise<void> {
    this.log(sessionId, 'stopSession')
    this.pendingUserInput.delete(sessionId)
    this.pendingElicitation.delete(sessionId)
    const state = this.sessions.get(sessionId)
    if (state?.abortController) {
      state.abortController.abort()
      state.abortController = undefined
    }
  }

  closeSession(sessionId: string): void {
    this.log(sessionId, 'closeSession')
    this.pendingUserInput.delete(sessionId)
    this.pendingElicitation.delete(sessionId)
    const state = this.sessions.get(sessionId)
    if (state?.abortController) state.abortController.abort()
    this.sessions.delete(sessionId)
  }

  async generateCommitMessage(worktreePath: string, settings: AgentSettings): Promise<string> {
    return generateCommitMessage(worktreePath, settings)
  }

  async generateSessionTitle(
    userMessage: string,
    assistantSummary: string,
    settings: AgentSettings,
    currentTitle?: string
  ): Promise<string> {
    return generateSessionTitle(userMessage, assistantSummary, settings, currentTitle)
  }

  async getSlashCommands(cwd: string): Promise<SlashCommand[]> {
    const cached = this.slashCommandsCache.get(cwd)
    if (cached) return cached
    const inflight = this.slashCommandsInflight.get(cwd)
    if (inflight) return inflight

    const promise = fetchSlashCommands(cwd, this.importSdk.bind(this), this.userCliPath)
    this.slashCommandsInflight.set(cwd, promise)
    try {
      const result = await promise
      this.slashCommandsCache.set(cwd, result)
      return result
    } finally {
      this.slashCommandsInflight.delete(cwd)
    }
  }

  private applyApiKey(settings: AgentSettings): void {
    if (settings.apiKey) process.env.ANTHROPIC_API_KEY = settings.apiKey
    else delete process.env.ANTHROPIC_API_KEY
    if (settings.claudeCodeExecutablePath) this.userCliPath = settings.claudeCodeExecutablePath
  }

  private log(sessionId: string, ...args: unknown[]): void {
    console.log(`[Agent${sessionId.slice(-6)}]`, ...args)
  }
}
