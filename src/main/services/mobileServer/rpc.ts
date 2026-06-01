import { execFile } from 'child_process'
import crypto from 'crypto'
import { app, BrowserWindow } from 'electron'
import { storageService } from '../storage'
import { gitService } from '../git'
import { agentService } from '../agent'
import { ptyService } from '../pty'
import { githubService } from '../github'
import { sessionStorageService } from '../sessionStorage'
import { enrichedEnv } from '../../lib/enrichedEnv'
import { MOBILE_PROTOCOL_VERSION } from './protocol'
import { getMobileInstanceName } from './instanceName'
import { markMobileTerminalActive, markMobileTerminalInactive } from './mobileTerminalPresence'
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

// ── Projects / Worktrees ──────────────────────────────────────────────────────

register('projects.list', async () => {
  const data = storageService.load()
  const projects = await Promise.all(data.projects.map(async (project) => ({
    ...project,
    worktrees: await gitService.getWorktrees(project.path).catch((err) => {
      console.warn('[MobileRPC] projects.list worktrees failed', { project: project.name, path: project.path, err })
      return []
    }),
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
  const terminals = ptyService.listInstances(worktreePath)
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
  return terminals
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
  const ptyId = await ptyService.spawn(worktreePath, { BRAID_TERMINAL_ID: terminalId })
  ptyService.registerBigTerminal(ptyId, terminalId)
  ptyService.setBigTerminalMetadata?.({
    terminalId,
    label,
    agentId,
    worktreeId: params.worktreeId as string | undefined,
  })
  const worktreeId = params.worktreeId as string | undefined
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('pty:bigTerminalRegistered', {
        terminalId,
        worktreeId,
        label,
        agentId,
      })
    }
  }
  if (command) ptyService.write(ptyId, `${command}\n`)
  console.log('[MobileRPC] terminal.create', { worktreePath, ptyId, terminalId, label, agentId, command })
  return {
    id: ptyId,
    ptyId,
    cwd: worktreePath,
    terminalId,
    title: label,
    label,
    agentId,
    worktreeId: params.worktreeId,
    worktreePath,
  }
})

register('terminal.write', async (params) => {
  ptyService.write(params.ptyId as string, params.data as string)
})

register('terminal.resize', async (params) => {
  ptyService.resize(params.ptyId as string, params.cols as number, params.rows as number)
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

  const unsubscribe = () => {
    unsubData()
    unsubExit()
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
