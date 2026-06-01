import { execFile } from 'child_process'
import crypto from 'crypto'
import { app, BrowserWindow } from 'electron'
import { storageService } from '../storage'
import { gitService } from '../git'
import { agentService } from '../agent'
import { ptyService } from '../pty'
import { githubService } from '../github'
import { sessionStorageService } from '../sessionStorage'
import { rateLimitService } from '../rateLimits/service'
import { enrichedEnv } from '../../lib/enrichedEnv'
import { MOBILE_PROTOCOL_VERSION } from './protocol'
import { getMobileInstanceName } from './instanceName'
import { markMobileTerminalActive, markMobileTerminalInactive } from './mobileTerminalPresence'
import { getMobileDisplayMode, resetMobileDisplayMode, setMobileDisplayMode, type MobileDisplayMode } from './mobileTerminalDisplay'
import { getTerminalActivity } from './terminalActivity'
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  RpcHandler,
  RpcMethodMap,
  MobileConnection,
} from './types'

// ── Error helpers ─────────────────────────────────────────────────────────────

function errorResponse(id: number | string | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

function successResponse(id: number | string, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result }
}

// ── Method Registry ───────────────────────────────────────────────────────────

const methods: RpcMethodMap = new Map()
const MOBILE_AGENT_CATALOG = [
  { id: 'claude', label: 'Claude Code', launchCmd: 'claude' },
  { id: 'codex', label: 'Codex', launchCmd: 'codex' },
  { id: 'gemini', label: 'Gemini CLI', launchCmd: 'gemini' },
]

function register(name: string, handler: RpcHandler): void {
  methods.set(name, handler)
}

// ── Status ────────────────────────────────────────────────────────────────────

register('status.get', async () => {
  const data = storageService.load()
  return {
    instanceName: getMobileInstanceName(),
    version: app.getVersion(),
    protocolVersion: MOBILE_PROTOCOL_VERSION,
    projects: data.projects.map((p) => ({ id: p.id, name: p.name, path: p.path })),
    uptime: process.uptime(),
  }
})

// ── Rate limits ─────────────────────────────────────────────────────────────
// Mirror the desktop's Claude/Codex usage (session + weekly windows) to mobile.
// `get` returns the desktop's cached state (cheap); `refresh` forces a re-fetch.

register('rateLimits.get', async () => rateLimitService.getState())

register('rateLimits.refresh', async () => rateLimitService.refresh())

// ── Projects / Worktrees ──────────────────────────────────────────────────────

register('projects.list', async () => {
  const data = storageService.load()
  // Attach the desktop's stable worktree id (path -> id) so terminals created
  // from mobile carry a worktreeId the desktop can bind to. See storage.ts.
  const worktreeIds = storageService.loadWorktreeIds()
  const projects = await Promise.all(data.projects.map(async (project) => ({
    ...project,
    worktrees: (await gitService.getWorktrees(project.path).catch((err) => {
      console.warn('[MobileRPC] projects.list worktrees failed', { project: project.name, path: project.path, err })
      return []
    })).map((worktree) => ({ ...worktree, id: worktreeIds[worktree.path] })),
  })))
  console.log('[MobileRPC] projects.list', projects.map((project) => ({
    id: project.id,
    name: project.name,
    path: project.path,
    worktrees: project.worktrees?.map((worktree) => ({
      path: worktree.path,
      branch: worktree.branch,
      isMain: worktree.isMain,
    })),
  })))
  return projects
})

register('shell.checkTool', async (params) => {
  const tool = String(params.tool ?? '').trim()
  if (!/^[a-zA-Z0-9-]+$/.test(tool)) return false
  return await new Promise<boolean>((resolve) => {
    execFile('which', [tool], { timeout: 3000, env: enrichedEnv() }, (err, stdout) => {
      const found = !err && stdout.split(/\r?\n/).some((line) => line.trim().startsWith('/'))
      if (found) console.log('[MobileRPC] shell.checkTool %s -> %s', tool, stdout.trim())
      resolve(found)
    })
  })
})

register('worktrees.list', async (params) => {
  return gitService.getWorktrees(params.projectPath as string)
})

register('worktrees.create', async (params) => {
  await gitService.addWorktree(
    params.repoPath as string,
    params.branch as string,
    params.projectName as string,
    params.baseBranch as string | undefined
  )
})

register('worktrees.remove', async (params) => {
  await gitService.removeWorktree(params.repoPath as string, params.worktreePath as string)
})

// ── Sessions ──────────────────────────────────────────────────────────────────

register('sessions.list', async () => {
  const sessions = sessionStorageService.loadAllSessions()
  // Return summaries without full message history
  return sessions.map((s) => ({
    id: s.id,
    worktreeId: s.worktreeId,
    name: s.name,
    customName: s.customName,
    status: s.status,
    model: s.model,
    createdAt: s.createdAt,
    worktreePath: s.worktreePath,
    messageCount: s.messages?.length ?? 0,
    totalRunDurationMs: s.totalRunDurationMs,
  }))
})

register('sessions.get', async (params) => {
  const sessions = sessionStorageService.loadAllSessions()
  return sessions.find((s) => s.id === params.sessionId) ?? null
})

register('sessions.start', async (params) => {
  await agentService.startSession(
    params.sessionId as string,
    params.worktreeId as string,
    params.worktreePath as string,
    params.prompt as string,
    params.model as string,
    (params.thinking as boolean) ?? false,
    (params.extendedContext as boolean) ?? false,
    (params.effortLevel as string) ?? 'default',
    (params.planMode as boolean) ?? false,
    (params.sessionName as string) ?? 'New Chat',
    params.images as string[] | undefined,
    params.additionalDirectories as string[] | undefined,
    params.linkedWorktreeContext as string | undefined,
    params.connectedDeviceId as string | undefined,
    params.mobileFramework as string | undefined,
  )
})

register('sessions.sendMessage', async (params) => {
  await agentService.sendMessage(
    params.sessionId as string,
    params.message as string,
    params.sdkSessionId as string,
    params.cwd as string,
    params.model as string,
    (params.extendedContext as boolean) ?? false,
    (params.effortLevel as string) ?? 'default',
    (params.planMode as boolean) ?? false,
    (params.sessionName as string) ?? 'New Chat',
    params.images as string[] | undefined,
    params.additionalDirectories as string[] | undefined,
    params.linkedWorktreeContext as string | undefined,
    params.connectedDeviceId as string | undefined,
    params.mobileFramework as string | undefined,
  )
})

register('sessions.stop', async (params) => {
  await agentService.stopSession(params.sessionId as string)
})

register('sessions.answerQuestion', async (params) => {
  agentService.answerToolInput(
    params.sessionId as string,
    params.result as Record<string, unknown>,
  )
})

register('sessions.answerElicitation', async (params) => {
  agentService.answerElicitation(
    params.sessionId as string,
    params.result as { action: 'accept' | 'decline' | 'cancel'; content?: Record<string, unknown> },
  )
})

// ── Git ───────────────────────────────────────────────────────────────────────

register('git.status', async (params) => {
  return gitService.getStatus(params.worktreePath as string)
})

register('git.diff', async (params) => {
  return gitService.getDiff(params.worktreePath as string)
})

register('git.fileDiff', async (params) => {
  return gitService.getFileDiff(
    params.worktreePath as string,
    params.file as string,
    params.status as string,
    params.staged as boolean,
  )
})

register('git.branches', async (params) => {
  return gitService.getBranches(params.repoPath as string)
})

register('git.stage', async (params) => {
  return gitService.stageFiles(params.worktreePath as string, params.files as string[])
})

register('git.unstage', async (params) => {
  return gitService.unstageFiles(params.worktreePath as string, params.files as string[])
})

register('git.discard', async (params) => {
  return gitService.discardChanges(
    params.worktreePath as string,
    params.file as string,
    params.status as string,
    params.staged as boolean | undefined,
  )
})

register('git.commit', async (params) => {
  return gitService.commit(params.worktreePath as string, params.message as string)
})

register('git.push', async (params) => {
  return gitService.push(params.worktreePath as string)
})

register('git.pull', async (params) => {
  return gitService.pull(
    params.worktreePath as string,
    params.strategy as 'rebase' | 'merge' | undefined,
  )
})

// ── GitHub ────────────────────────────────────────────────────────────────────

register('github.prStatus', async (params) => {
  return githubService.getPrStatus(params.worktreePath as string)
})

register('github.checks', async (params) => {
  return githubService.getChecks(params.worktreePath as string)
})

register('github.syncStatus', async (params) => {
  return githubService.getGitSyncStatus(
    params.worktreePath as string,
    params.baseBranch as string,
  )
})

// ── Terminal ──────────────────────────────────────────────────────────────────

register('terminal.list', async (params) => {
  const worktreePath = params.worktreePath as string | undefined
  // Ensure the daemon connection (and its metadata hydration) is ready, so
  // terminals come back with their real labels after an app restart.
  await ptyService.ensureDaemon?.()
  // Only surface big terminals (center-panel agent sessions, prefix "bt-") to
  // mobile. Right-side-panel terminals (prefix "rt-") register for scrollback
  // persistence too, so they also appear in listInstances with a terminalId -
  // but the "bt-" prefix filter excludes them, and they carry no label metadata.
  //
  // Also require a registered label (metadata): a "bt-" PTY whose metadata has
  // been removed is an orphaned/closed session that the desktop no longer shows
  // as a tab. Surfacing it would leak a stale terminal labelled with its raw
  // "bt-<timestamp>" id. Every live tab has metadata, so this is a safe filter.
  const terminals = ptyService
    .listInstances(worktreePath)
    .filter((terminal) => terminal.terminalId?.startsWith('bt-') && terminal.label)
  console.log('[MobileRPC] terminal.list', {
    worktreePath,
    terminals: terminals.map((terminal) => ({
      ptyId: terminal.ptyId,
      cwd: terminal.cwd,
      terminalId: terminal.terminalId,
      title: terminal.title,
      label: terminal.label,
      agentId: terminal.agentId,
    })),
  })
  // Enrich each terminal with its current agent state so the mobile homepage can
  // surface which agents need attention without a separate status RPC.
  return terminals.map((terminal) => ({
    ...terminal,
    status: terminal.terminalId ? getTerminalActivity(terminal.terminalId) : undefined,
  }))
})

register('terminal.create', async (params) => {
  const worktreePath = params.worktreePath as string
  if (!worktreePath) throw new Error('worktreePath is required')
  const requestedAgentId = (params.agentId as string | undefined)?.trim() || MOBILE_AGENT_CATALOG[0]?.id || 'claude'
  const agent = MOBILE_AGENT_CATALOG.find((item) => item.id === requestedAgentId)
  const label = (params.label as string | undefined)?.trim() || agent?.label || 'Terminal'
  const command = (params.command as string | undefined)?.trim() || agent?.launchCmd || 'claude'
  const agentId = agent?.id || requestedAgentId
  const terminalId = `bt-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`
  // Prefer the id the client sent, but fall back to the registry keyed by path.
  // The registry covers worktrees reachable via deep links that the client
  // could not resolve to an id, so the desktop can still bind the terminal.
  const worktreeId = (params.worktreeId as string | undefined) || storageService.loadWorktreeIds()[worktreePath]
  const ptyId = await ptyService.spawn(worktreePath, { BRAID_TERMINAL_ID: terminalId })
  ptyService.registerBigTerminal(ptyId, terminalId)
  ptyService.setBigTerminalMetadata?.({
    terminalId,
    label,
    agentId,
    worktreeId,
  })
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('pty:bigTerminalRegistered', {
        terminalId,
        worktreeId,
        worktreePath,
        label,
        agentId,
      })
    }
  }
  if (command) ptyService.write(ptyId, `${command}\n`)
  console.log('[MobileRPC] terminal.create', { worktreePath, ptyId, terminalId, worktreeId, label, agentId, command })
  return {
    id: ptyId,
    ptyId,
    cwd: worktreePath,
    terminalId,
    title: label,
    label,
    agentId,
    worktreeId,
    worktreePath,
  }
})

register('terminal.close', async (params) => {
  const terminalId = params.terminalId as string | undefined
  const ptyId = params.ptyId as string | undefined
  // Prefer the big-terminal id: killBigTerminal reaps the PTY and removes the
  // metadata, which is what makes the tab disappear from terminal.list (a "bt-"
  // PTY without metadata is treated as a closed/orphaned session). Fall back to
  // a raw PTY kill when only the ptyId is known.
  if (terminalId && ptyService.killBigTerminal) {
    ptyService.killBigTerminal(terminalId)
  } else if (ptyId) {
    ptyService.kill(ptyId)
  } else {
    throw new Error('terminalId or ptyId is required')
  }
  console.log('[MobileRPC] terminal.close', { terminalId, ptyId })
  return { closed: true }
})

register('terminal.write', async (params) => {
  ptyService.write(params.ptyId as string, params.data as string)
})

register('terminal.resize', async (params) => {
  ptyService.resize(params.ptyId as string, params.cols as number, params.rows as number)
})

// Switch a terminal between 'phone' (desktop yields, PTY fit to the phone's
// viewport) and 'desktop' (desktop drives its native dims, phone scales to fit).
register('terminal.setDisplayMode', async (params) => {
  const ptyId = params.ptyId as string
  const mode: MobileDisplayMode = params.mode === 'desktop' ? 'desktop' : 'phone'
  const instance = ptyService.listInstances().find((item) => item.ptyId === ptyId)
  const terminalId = (params.terminalId as string | undefined) ?? instance?.terminalId
  if (terminalId) setMobileDisplayMode(terminalId, mode)

  if (mode === 'phone') {
    // Re-engage phone fit: resize the PTY to the viewport the device measured.
    const viewport = params.viewport as { cols?: number; rows?: number } | undefined
    if (viewport?.cols && viewport?.rows) {
      ptyService.resize(ptyId, viewport.cols, viewport.rows)
    }
  }
  // For 'desktop' the desktop renderer un-holds and fits to its own pane; the
  // resulting resize streams back via the 'terminal.resized' subscription.

  const size = ptyService.getSize?.(ptyId) ?? null
  return { displayMode: mode, cols: size?.cols ?? null, rows: size?.rows ?? null }
})

register('terminal.readScrollback', async (params) => {
  const ptyId = params.ptyId as string | undefined
  const worktreePath = params.worktreePath as string | undefined
  console.log('[MobileRPC] terminal.readScrollback request', { ptyId, worktreePath })
  if (ptyId) {
    const instance = ptyService.listInstances().find((item) => item.ptyId === ptyId)
    console.log('[MobileRPC] terminal.readScrollback instance', { ptyId, instance })
    if (!instance) return ''
    const results = ptyService.readTerminalOutput(instance.cwd)
    const output = results.find((item) => item.ptyId === ptyId)?.output ?? ''
    console.log('[MobileRPC] terminal.readScrollback result', { ptyId, length: output.length })
    return output
  }
  if (worktreePath) {
    const results = ptyService.readTerminalOutput(worktreePath)
    const output = results.length > 0 ? results[0].output : ''
    console.log('[MobileRPC] terminal.readScrollback result', { worktreePath, length: output.length })
    return output
  }
  return ''
})

// ── Subscriptions ─────────────────────────────────────────────────────────────

register('agent.subscribe', async (params, connection) => {
  const subscriptionId = `sub-${crypto.randomUUID().slice(0, 8)}`
  const sessionFilter = params.sessionId as string | undefined

  const unsubscribe = agentService.onEvent((sessionId: string, event: unknown) => {
    if (sessionFilter && sessionId !== sessionFilter) return
    // Push notification to this specific connection (will be encrypted by caller)
    connection.ws.emit('rpc:notification', {
      jsonrpc: '2.0' as const,
      method: 'agent.event',
      params: { subscriptionId, sessionId, event },
    })
  })

  connection.subscriptions.set(subscriptionId, unsubscribe)
  return { subscriptionId }
})

register('agent.unsubscribe', async (params, connection) => {
  const subId = params.subscriptionId as string
  const unsub = connection.subscriptions.get(subId)
  if (unsub) {
    unsub()
    connection.subscriptions.delete(subId)
  }
})

register('terminal.subscribe', async (params, connection) => {
  const subscriptionId = `sub-${crypto.randomUUID().slice(0, 8)}`
  const ptyId = params.ptyId as string
  const instance = ptyService.listInstances().find((item) => item.ptyId === ptyId)
  const terminalId = instance?.terminalId
  console.log('[MobileRPC] terminal.subscribe', { subscriptionId, ptyId, terminalId })
  if (terminalId) markMobileTerminalActive(terminalId)

  const unsubData = ptyService.onData(ptyId, (_id: string, data: string) => {
    console.log('[MobileRPC] terminal.data', { subscriptionId, ptyId, length: data.length })
    connection.ws.emit('rpc:notification', {
      jsonrpc: '2.0' as const,
      method: 'terminal.data',
      params: { subscriptionId, ptyId, data },
    })
  })

  const unsubExit = ptyService.onExit(ptyId, (_id: string, exitCode: number) => {
    connection.ws.emit('rpc:notification', {
      jsonrpc: '2.0' as const,
      method: 'terminal.exit',
      params: { subscriptionId, ptyId, exitCode },
    })
  })

  // Stream PTY dimension changes so the device can resize its (CSS-scaling)
  // xterm to match — this is how 'desktop' display mode shows the terminal at
  // the desktop's native size.
  const emitResized = (cols: number, rows: number) => {
    connection.ws.emit('rpc:notification', {
      jsonrpc: '2.0' as const,
      method: 'terminal.resized',
      params: { subscriptionId, ptyId, cols, rows, displayMode: terminalId ? getMobileDisplayMode(terminalId) : 'phone' },
    })
  }
  const unsubResize = ptyService.onResize?.(ptyId, (_id: string, cols: number, rows: number) => emitResized(cols, rows))
  // Send the current dimensions + mode once so a device reconnecting into an
  // existing terminal immediately knows whether it is phone- or desktop-sized.
  const currentSize = ptyService.getSize?.(ptyId)
  if (currentSize) emitResized(currentSize.cols, currentSize.rows)

  const unsubscribe = () => {
    unsubData()
    unsubExit()
    unsubResize?.()
    if (terminalId) resetMobileDisplayMode(terminalId)
    if (terminalId) markMobileTerminalInactive(terminalId)
  }
  connection.subscriptions.set(subscriptionId, unsubscribe)
  return { subscriptionId }
})

register('terminal.unsubscribe', async (params, connection) => {
  const subId = params.subscriptionId as string
  const unsub = connection.subscriptions.get(subId)
  if (unsub) {
    unsub()
    connection.subscriptions.delete(subId)
  }
})

// ── Notifications ───────────────────────────────────────────────────────────
//
// Streams agent done/error/waiting notifications to the device so it can raise
// a local OS notification. The payload carries deep-link hints (worktreePath +
// terminalId) so a tap can open the exact terminal tab on mobile.

register('notifications.subscribe', async (_params, connection) => {
  const subscriptionId = `sub-${crypto.randomUUID().slice(0, 8)}`

  const unsubscribe = agentService.onNotify((notification) => {
    connection.ws.emit('rpc:notification', {
      jsonrpc: '2.0' as const,
      method: 'notification',
      params: { subscriptionId, ...notification },
    })
  })

  connection.subscriptions.set(subscriptionId, unsubscribe)
  return { subscriptionId }
})

register('notifications.unsubscribe', async (params, connection) => {
  const subId = params.subscriptionId as string
  const unsub = connection.subscriptions.get(subId)
  if (unsub) {
    unsub()
    connection.subscriptions.delete(subId)
  }
})

// ── Dispatch ──────────────────────────────────────────────────────────────────

/**
 * Dispatch a JSON-RPC request to the appropriate handler.
 * Returns a JSON-RPC response object.
 */
export async function dispatch(
  request: JsonRpcRequest,
  connection: MobileConnection
): Promise<JsonRpcResponse> {
  const handler = methods.get(request.method)
  if (!handler) {
    return errorResponse(request.id, -32601, `Method not found: ${request.method}`)
  }

  try {
    const result = await handler(request.params ?? {}, connection)
    return successResponse(request.id, result ?? null)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return errorResponse(request.id, -32603, message)
  }
}

/** Get the list of registered RPC method names (useful for debugging). */
export function getMethodNames(): string[] {
  return Array.from(methods.keys())
}
