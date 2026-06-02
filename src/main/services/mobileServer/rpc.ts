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
import { MOBILE_PROTOCOL_VERSION, MIN_COMPATIBLE_MOBILE_VERSION, MOBILE_CAPABILITIES } from './protocol'
import { getMobileInstanceName } from './instanceName'
import { markMobileTerminalActive, markMobileTerminalInactive, getTerminalPresence } from './mobileTerminalPresence'
import { getMobileDisplayMode, resetMobileDisplayMode, setMobileDisplayMode, type MobileDisplayMode } from './mobileTerminalDisplay'
import { clearMobileTerminalActor, isMobileTerminalActor, setMobileTerminalActor } from './mobileTerminalActor'
import { getTerminalActivity } from './terminalActivity'
import { getKnownBigTerminals, hasKnownBigTerminals } from './knownBigTerminals'
import { broadcastMobileNotification } from './broadcast'
import { budgetScrollback } from './scrollbackBudget'
import { createWorktreeViaDesktop } from './worktreeCreation'
import { removeWorktreeViaDesktop } from './worktreeRemoval'
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  RpcHandler,
  RpcMethodMap,
  MobileConnection,
} from './types'

// ── Terminal output coalescing ──────────────────────────────────────────────
//
// Window over which PTY output chunks are batched into a single terminal.data
// frame (see terminal.subscribe). Short enough to stay imperceptible for
// interactive echo, long enough to collapse bursty output into a few frames.
const TERMINAL_COALESCE_MS = 5
// Flush immediately once the buffer reaches this size so a firehose of output
// streams promptly instead of accumulating latency while it waits for the timer.
const TERMINAL_COALESCE_MAX_BYTES = 32 * 1024


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
    // Desktop-side kill switch: the oldest mobile build this server accepts. The
    // mobile compat verdict blocks anything below it. Paired with `capabilities`,
    // this lets a newer desktop stay compatible with older mobile builds unless a
    // genuinely breaking change forces the floor up.
    minCompatibleMobileVersion: MIN_COMPATIBLE_MOBILE_VERSION,
    capabilities: MOBILE_CAPABILITIES,
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
  // Route through the desktop renderer's full add flow (stable worktree-id
  // minting, configured storage path, sidebar refresh) rather than calling git
  // directly — see worktreeCreation.ts.
  // Returns { worktreePath?, worktreeId? } so the device can navigate straight
  // into the new worktree and auto-launch its chosen agent.
  return await createWorktreeViaDesktop(
    params.repoPath as string,
    params.branch as string,
    params.projectName as string,
    params.baseBranch as string | undefined,
  )
})

register('worktrees.remove', async (params) => {
  // Route through the desktop renderer's full teardown flow (archive script,
  // terminal/PTY disposal, session cascade-delete, UI cleanup, then git remove)
  // rather than calling git directly — see worktreeRemoval.ts.
  await removeWorktreeViaDesktop(params.repoPath as string, params.worktreePath as string)
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

register('git.branchStatus', async (params) => {
  return gitService.getBranchStatus(params.worktreePath as string)
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
  // Resolve the worktree's stable id so we can match terminals the same way the
  // desktop does. This is the crux of "desktop shows the tabs but mobile sees
  // none": the desktop tracks big terminals by worktreeId/terminalId and never
  // compares cwd, whereas a strict `cwd === worktreePath` match silently drops
  // everything when the daemon's stored cwd differs from the path mobile
  // resolved (symlinked paths like /var vs /private/var, a trailing slash, etc).
  const normalize = (path?: string): string | undefined => path?.replace(/\/+$/, '')
  const targetPath = normalize(worktreePath)
  // Resolve the worktree id by normalized-path comparison (not a strict key
  // lookup) so a path-format difference can't also defeat the id match.
  const worktreeIdMap = storageService.loadWorktreeIds()
  const worktreeId = worktreePath
    ? worktreeIdMap[worktreePath] ?? Object.entries(worktreeIdMap).find(([path]) => normalize(path) === targetPath)?.[1]
    : undefined

  // Source the terminal set from the DAEMON, not the in-process instance map.
  // listInstances() only holds sessions this process spawned/reattached (i.e.
  // worktrees the desktop opened this session), which is why non-opened
  // worktrees' terminals were invisible until clicked. The daemon's session list
  // has every live "bt-" session regardless of whether the desktop reattached it.
  //
  // To keep orphans out without depending on a label, intersect with the
  // renderer's persisted-id set (the desktop's authoritative "what should
  // exist"). Until the renderer has pushed that set, fall back to the in-process
  // map so a fresh start can never surface a stale orphan.
  const daemonSessions = (await ptyService.listSessions?.()) ?? []
  const known = getKnownBigTerminals()
  const useKnown = hasKnownBigTerminals()
  const fallbackById = new Map(ptyService.listInstances().map((instance) => [instance.terminalId, instance]))

  const matchesWorktree = (cwd: string, metaWorktreeId?: string): boolean => {
    if (!worktreePath) return true
    if (worktreeId && metaWorktreeId === worktreeId) return true
    return normalize(cwd) === targetPath
  }

  const terminals = daemonSessions
    .filter((session) => {
      if (!session.sessionId.startsWith('bt-')) return false
      // Orphan guard: only surface terminals the desktop still tracks. Before the
      // renderer reports its set, restrict to sessions already in the in-process
      // map (reattached this session) so we never leak orphans.
      if (useKnown ? !known.has(session.sessionId) : !fallbackById.has(session.sessionId)) return false
      const meta = known.get(session.sessionId)
      return matchesWorktree(session.cwd, meta?.worktreeId ?? session.metadata?.worktreeId)
    })
    .map((session) => {
      const meta = known.get(session.sessionId)
      const instance = fallbackById.get(session.sessionId)
      // Prefer the renderer's label - it's the source of truth and is present
      // even when the daemon's own metadata label never got set (the label lives
      // in renderer state, not always in the daemon), which is why a terminal
      // would otherwise fall back to its cwd basename for a name.
      const label = meta?.label || session.metadata?.label || instance?.label || session.cwd.split('/').pop() || session.sessionId
      return {
        id: session.sessionId,
        ptyId: session.sessionId,
        terminalId: session.sessionId,
        cwd: session.cwd,
        title: label,
        label,
        agentId: meta?.agentId ?? session.metadata?.agentId ?? instance?.agentId,
        worktreeId: meta?.worktreeId ?? session.metadata?.worktreeId ?? instance?.worktreeId,
        status: getTerminalActivity(session.sessionId),
        // Monotonic accumulated working time. Mobile needs this both for its
        // "agent time" total and to fingerprint a finished agent so a re-run
        // (which adds more working time) re-surfaces in "Needs attention".
        totalRunDurationMs: session.metadata?.totalRunDurationMs ?? instance?.totalRunDurationMs,
      }
    })
  console.log('[MobileRPC] terminal.list', {
    worktreePath,
    worktreeId,
    useKnown,
    knownCount: known.size,
    matched: terminals.map((terminal) => ({ terminalId: terminal.terminalId, label: terminal.label })),
  })
  return terminals
})

// Fan a big-terminal tab lifecycle change out to every desktop renderer window
// so the center-panel tab strip updates live (mirrors terminal.create's
// 'pty:bigTerminalRegistered' broadcast).
function notifyDesktopWindows(channel: string, payload: Record<string, unknown>): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

// Tell desktop renderers the phone-fit dimensions a mobile device just applied
// to the shared PTY. A held big-terminal pane mirrors its xterm to these dims so
// the buffer is laid out at the same width the phone saw; when the desktop later
// restores its own dimensions xterm reflows cleanly instead of leaving
// phone-width scrollback stranded in a wide pane.
function notifyMobileFit(terminalId: string | undefined, cols: number, rows: number): void {
  if (!terminalId) return
  notifyDesktopWindows('pty:mobileFit', { terminalId, cols, rows })
}

// Resolve the worktree path + id for a big terminal from its live PTY instance,
// so a rename/close notification carries enough context for the desktop and
// other devices to locate the tab.
function resolveTerminalContext(terminalId?: string, ptyId?: string): {
  terminalId?: string
  worktreePath?: string
  worktreeId?: string
  agentId?: string
} {
  const instances = ptyService.listInstances()
  const instance = terminalId
    ? instances.find((item) => item.terminalId === terminalId)
    : instances.find((item) => item.ptyId === ptyId)
  return {
    terminalId: terminalId ?? instance?.terminalId,
    worktreePath: instance?.cwd,
    worktreeId: instance?.worktreeId,
    agentId: instance?.agentId,
  }
}

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
  // Notify other connected devices so their tab strip picks up the new terminal.
  // The originator already adds it optimistically; the refresh is non-disruptive
  // (it never re-opens the active tab) so broadcasting to all is harmless.
  broadcastMobileNotification({ jsonrpc: '2.0', method: 'terminal.listChanged', params: { worktreePath } })
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

register('terminal.close', async (params, connection) => {
  const terminalId = params.terminalId as string | undefined
  const ptyId = params.ptyId as string | undefined
  // Capture the worktree context before killing - killBigTerminal removes the
  // metadata, so the desktop/other devices would otherwise lose the worktree id.
  const context = resolveTerminalContext(terminalId, ptyId)
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
  if (context.terminalId) {
    // Reflect the close on the desktop (remove the center-panel tab) and on
    // every other paired device. The originating device already dropped the tab.
    notifyDesktopWindows('pty:bigTerminalClosed', context)
    broadcastMobileNotification(
      { jsonrpc: '2.0', method: 'terminal.tabClosed', params: { ...context } },
      connection.device.id,
    )
  }
  return { closed: true }
})

// Report whether a terminal is currently open anywhere other than the asking
// device - the desktop (any window viewing that big terminal) or another paired
// device subscribed to it. Drives the mobile "this session is also open on the
// desktop / another device" close warning. Capability: terminal.presence.v1.
register('terminal.presence', async (params, connection) => {
  const terminalId = (params.terminalId as string | undefined)
    ?? resolveTerminalContext(undefined, params.ptyId as string | undefined).terminalId
  if (!terminalId) return { openElsewhere: false, openOnDesktop: false, otherDeviceCount: 0 }
  const { openOnDesktop, otherMobileDeviceCount } = getTerminalPresence(terminalId, {
    excludeDeviceId: connection.device.id,
  })
  return {
    terminalId,
    openOnDesktop,
    otherDeviceCount: otherMobileDeviceCount,
    openElsewhere: openOnDesktop || otherMobileDeviceCount > 0,
  }
})

// Rename a big terminal's tab from a device. Updates the persisted metadata,
// reflects the new label on the desktop, and fans it out to other devices.
register('terminal.rename', async (params, connection) => {
  const terminalId = params.terminalId as string | undefined
  const ptyId = params.ptyId as string | undefined
  const label = (params.label as string | undefined)?.trim()
  if (!label) throw new Error('label is required')
  const context = resolveTerminalContext(terminalId, ptyId)
  if (!context.terminalId) throw new Error('terminalId or ptyId is required')
  ptyService.setBigTerminalMetadata?.({
    terminalId: context.terminalId,
    label,
    agentId: context.agentId,
    worktreeId: context.worktreeId,
  })
  const payload = { ...context, label }
  notifyDesktopWindows('pty:bigTerminalRenamed', payload)
  broadcastMobileNotification(
    { jsonrpc: '2.0', method: 'terminal.tabRenamed', params: payload },
    connection.device.id,
  )
  console.log('[MobileRPC] terminal.rename', payload)
  return { renamed: true, label }
})

register('terminal.write', async (params) => {
  ptyService.write(params.ptyId as string, params.data as string)
})

register('terminal.resize', async (params, connection) => {
  const ptyId = params.ptyId as string
  // A device fitting the PTY to its own viewport claims the floor: its size
  // wins and other subscribers yield (see mobileTerminalActor).
  const terminalId = ptyService.listInstances().find((item) => item.ptyId === ptyId)?.terminalId
  if (terminalId) setMobileTerminalActor(terminalId, connection.device.id)
  ptyService.resize(ptyId, params.cols as number, params.rows as number)
  notifyMobileFit(terminalId, params.cols as number, params.rows as number)
})

// Switch a terminal between 'phone' (desktop yields, PTY fit to the phone's
// viewport) and 'desktop' (desktop drives its native dims, phone scales to fit).
register('terminal.setDisplayMode', async (params, connection) => {
  const ptyId = params.ptyId as string
  const mode: MobileDisplayMode = params.mode === 'desktop' ? 'desktop' : 'phone'
  const instance = ptyService.listInstances().find((item) => item.ptyId === ptyId)
  const terminalId = (params.terminalId as string | undefined) ?? instance?.terminalId
  if (terminalId) setMobileDisplayMode(terminalId, mode)

  if (mode === 'phone') {
    // Re-engage phone fit: resize the PTY to the viewport the device measured.
    // Doing so claims the floor - this device's size now wins over other phones.
    const viewport = params.viewport as { cols?: number; rows?: number } | undefined
    if (viewport?.cols && viewport?.rows) {
      if (terminalId) setMobileTerminalActor(terminalId, connection.device.id)
      ptyService.resize(ptyId, viewport.cols, viewport.rows)
      notifyMobileFit(terminalId, viewport.cols, viewport.rows)
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
  // Clients on protocol v3+ pass a byte budget so a huge ring buffer doesn't
  // ship as one giant frame and stall first paint. Absent/zero => full buffer
  // (older clients, unchanged behaviour).
  const maxBytes = typeof params.maxBytes === 'number' ? params.maxBytes : undefined
  console.log('[MobileRPC] terminal.readScrollback request', { ptyId, worktreePath, maxBytes })
  if (ptyId) {
    const instance = ptyService.listInstances().find((item) => item.ptyId === ptyId)
    console.log('[MobileRPC] terminal.readScrollback instance', { ptyId, instance })
    if (!instance) return ''
    const results = ptyService.readTerminalOutput(instance.cwd)
    const output = budgetScrollback(results.find((item) => item.ptyId === ptyId)?.output ?? '', maxBytes)
    console.log('[MobileRPC] terminal.readScrollback result', { ptyId, length: output.length })
    return output
  }
  if (worktreePath) {
    const results = ptyService.readTerminalOutput(worktreePath)
    const output = budgetScrollback(results.length > 0 ? results[0].output : '', maxBytes)
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
  if (terminalId) markMobileTerminalActive(terminalId, connection.device.id)

  // Ensure this process is attached to the daemon session so its live output
  // streams to onData below. After a cold start a restored big terminal is
  // hydrated into the instance list but not yet attached (the desktop reattaches
  // lazily, per worktree), so without this onData never fires and the device
  // sees a frozen, blank terminal for any session the desktop hasn't opened.
  await ptyService.reattach?.(ptyId)

  // Pre-fit the PTY to the device's viewport now, before the snapshot is
  // captured below - so the snapshot is serialized at the phone's width (no
  // mis-sized flash on open) and this device immediately claims the viewport
  // actor (multi-phone "most recent open wins": an earlier subscriber yields and
  // CSS-scales instead of fighting over the shared PTY size). This is safe even
  // though the resize's SIGWINCH makes a TUI repaint: snapshot-on-subscribe
  // captures + returns the snapshot *in this response*, ahead of any live frame,
  // so the repaint can't race in front of it. Skipped in 'desktop' display mode,
  // where the desktop drives its native dims and the phone scales to fit. The
  // device still issues its authoritative terminal.resize after measuring.
  const subscribeViewport = params.viewport as { cols?: number; rows?: number } | undefined
  const subscribeDisplayMode = terminalId ? getMobileDisplayMode(terminalId) : 'phone'
  if (
    subscribeDisplayMode !== 'desktop' &&
    Number.isInteger(subscribeViewport?.cols) && (subscribeViewport!.cols as number) > 0 &&
    Number.isInteger(subscribeViewport?.rows) && (subscribeViewport!.rows as number) > 0
  ) {
    if (terminalId) setMobileTerminalActor(terminalId, connection.device.id)
    ptyService.resize(ptyId, subscribeViewport!.cols as number, subscribeViewport!.rows as number)
    notifyMobileFit(terminalId, subscribeViewport!.cols as number, subscribeViewport!.rows as number)
  }

  // Coalesce PTY output. Bursty programs (build logs, `cat`, `yarn install`)
  // emit many tiny chunks; sending one notification each pays full
  // encrypt + base64 + WS-frame overhead per chunk and floods the device with
  // bridge hops. Instead we buffer and flush on a short timer, collapsing a
  // burst into a few large frames. The delay (TERMINAL_COALESCE_MS) is well
  // below human perception, so interactive echo still feels instant; a hard
  // byte cap flushes immediately so a firehose can't grow unbounded latency.
  let pending = ''
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  const flush = () => {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    if (!pending) return
    const data = pending
    pending = ''
    if (connection.binaryTerminalData) {
      // Fast path: raw bytes in an encrypted binary frame (no JSON escape, no
      // base64). The mobile client routes terminal output by ptyId, so the
      // subscriptionId is not needed on the wire here.
      connection.ws.emit('rpc:binary', { ptyId, data })
      return
    }
    connection.ws.emit('rpc:notification', {
      jsonrpc: '2.0' as const,
      method: 'terminal.data',
      params: { subscriptionId, ptyId, data },
    })
  }

  const unsubData = ptyService.onData(ptyId, (_id: string, data: string) => {
    pending += data
    if (pending.length >= TERMINAL_COALESCE_MAX_BYTES) {
      flush()
      return
    }
    if (!flushTimer) flushTimer = setTimeout(flush, TERMINAL_COALESCE_MS)
  })

  const unsubExit = ptyService.onExit(ptyId, (_id: string, exitCode: number) => {
    // Drain buffered output before the exit so the device never sees the
    // terminal close ahead of its final bytes.
    flush()
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
    // `selfDriven` tells this device whether it currently owns the viewport. A
    // non-actor phone uses it to yield (CSS-scale to the shared dims) instead of
    // re-asserting its own fit, which would ping-pong the PTY between two phones.
    const selfDriven = terminalId ? isMobileTerminalActor(terminalId, connection.device.id) : true
    connection.ws.emit('rpc:notification', {
      jsonrpc: '2.0' as const,
      method: 'terminal.resized',
      params: { subscriptionId, ptyId, cols, rows, displayMode: terminalId ? getMobileDisplayMode(terminalId) : 'phone', selfDriven },
    })
  }
  const unsubResize = ptyService.onResize?.(ptyId, (_id: string, cols: number, rows: number) => emitResized(cols, rows))
  // Send the current dimensions + mode once so a device reconnecting into an
  // existing terminal immediately knows whether it is phone- or desktop-sized.
  const currentSize = ptyService.getSize?.(ptyId)
  if (currentSize) emitResized(currentSize.cols, currentSize.rows)

  const unsubscribe = () => {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    pending = ''
    unsubData()
    unsubExit()
    unsubResize?.()
    if (terminalId) resetMobileDisplayMode(terminalId)
    if (terminalId) markMobileTerminalInactive(terminalId, connection.device.id)
    // Release the floor only if this device held it, so a remaining phone can
    // reclaim its own fit on its next resize instead of staying yielded forever.
    if (terminalId) clearMobileTerminalActor(terminalId, connection.device.id)
  }
  connection.subscriptions.set(subscriptionId, unsubscribe)

  // Snapshot-on-subscribe (capability: terminal.subscribe-snapshot.v1). Return
  // the scrollback in this result instead of letting the device fetch it via a
  // separate readScrollback *after* subscribe - that ordering lets live output
  // (and a resize-driven TUI repaint) get written ahead of the historical
  // snapshot. Captured synchronously here: onData is already wired (so nothing
  // is missed) and no flush has run, so the snapshot is a clean prefix and live
  // deltas start exactly where it ends. `pending` is empty at this point (no
  // PTY data can arrive during this synchronous block) but we clear it
  // defensively so no pre-snapshot byte is ever resent on the live channel.
  let snapshot: string | undefined
  if (connection.subscribeSnapshot) {
    const maxBytes = typeof params.maxBytes === 'number' ? params.maxBytes : undefined
    // Re-resolve cwd post-reattach: a cold-restored terminal may not have been
    // in listInstances() when `instance` was captured at the top, but is now -
    // matching what a separate readScrollback would have found.
    const cwd = instance?.cwd ?? ptyService.listInstances().find((item) => item.ptyId === ptyId)?.cwd
    const raw = cwd
      ? ptyService.readTerminalOutput(cwd).find((item) => item.ptyId === ptyId)?.output ?? ''
      : ''
    snapshot = budgetScrollback(raw, maxBytes)
    pending = ''
  }

  return { subscriptionId, snapshot }
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
