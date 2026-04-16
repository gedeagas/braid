// ---------------------------------------------------------------------------
// Session persistence — save/load sessions to/from disk via IPC
// ---------------------------------------------------------------------------

import type { AgentSession, Message, ModelId } from '@/types'
import * as ipc from '@/lib/ipc'
import { sessionWorktreePaths, sessionLinkedPaths, lastActivePerWorktree } from './storage'

// ---------------------------------------------------------------------------
// Lazy store binding — avoids circular import through ./store
// store.ts calls bindSessionsStore() once after create()
// ---------------------------------------------------------------------------

type SessionGetter = (sessionId: string) => AgentSession | undefined
let _getSession: SessionGetter = () => undefined

/** Wire up the sessions store getter. Called once by store.ts after create(). */
export function bindSessionsStore(getter: SessionGetter): void {
  _getSession = getter
}

/** Persist a session to disk (fire-and-forget) */
export function persistSession(sessionId: string): void {
  const session = _getSession(sessionId)
  if (!session) return
  const worktreePath = sessionWorktreePaths.get(sessionId) ?? ''
  const { activity: _, runStartedAt: _rs, ...rest } = session
  ipc.sessions.save({ ...rest, worktreePath, linkedWorktrees: session.linkedWorktrees }).catch(() => {})
}

/** Load all persisted sessions from disk and hydrate into store-ready shape */
export async function hydratePersistedSessions(): Promise<{
  sessions: Record<string, AgentSession>
  activeSessionId: string | null
}> {
  const persisted = await ipc.sessions.loadAll() as Array<{
    id: string
    worktreeId: string
    name: string
    customName: boolean
    sdkSessionId?: string
    status: string
    model: string
    thinkingEnabled: boolean
    messages: Message[]
    createdAt: number
    worktreePath: string
  }>

  if (!persisted || persisted.length === 0) {
    return { sessions: {}, activeSessionId: null }
  }

  const sessions: Record<string, AgentSession> = {}
  for (const p of persisted) {
    sessions[p.id] = {
      id: p.id,
      worktreeId: p.worktreeId,
      name: p.name,
      customName: p.customName,
      sdkSessionId: p.sdkSessionId,
      status: (p.status === 'running' || p.status === 'waiting_input' || p.status === 'error') ? 'idle' : p.status as AgentSession['status'],
      model: p.model as ModelId,
      thinkingEnabled: p.thinkingEnabled,
      extendedContext: (p as Record<string, unknown>).extendedContext as boolean ?? false,
      planModeEnabled: (p as Record<string, unknown>).planModeEnabled as boolean ?? false,
      messages: p.messages.filter(
        (m) => !(m.role === 'system' && typeof m.content === 'string' && m.content.startsWith('Error: Session process exited'))
      ),
      activity: null,
      runStartedAt: null,
      runCompletedAt: (p as Record<string, unknown>).runCompletedAt as number | null ?? null,
      totalRunDurationMs: (p as Record<string, unknown>).totalRunDurationMs as number ?? 0,
      tokenUsage: (p as Record<string, unknown>).tokenUsage as AgentSession['tokenUsage'] ?? null,
      contextTokens: (p as Record<string, unknown>).contextTokens as number | null ?? null,
      createdAt: p.createdAt,
      linkedWorktrees: (p as Record<string, unknown>).linkedWorktrees as AgentSession['linkedWorktrees']
    }
    sessionWorktreePaths.set(p.id, p.worktreePath)
    const linkedPaths = sessions[p.id].linkedWorktrees?.map((lw) => lw.path) ?? []
    if (linkedPaths.length > 0) {
      sessionLinkedPaths.set(p.id, linkedPaths)
    }
  }

  // Seed lastActivePerWorktree for worktrees that don't have one yet
  const byWorktree = new Map<string, typeof persisted>()
  for (const p of persisted) {
    const arr = byWorktree.get(p.worktreeId) ?? []
    arr.push(p)
    byWorktree.set(p.worktreeId, arr)
  }
  for (const [wtId, wtSessions] of byWorktree) {
    if (!lastActivePerWorktree.has(wtId)) {
      const newest = wtSessions.sort((a, b) => b.createdAt - a.createdAt)[0]
      lastActivePerWorktree.set(wtId, newest.id)
    }
  }

  // Pick the most recently created session as active
  const sorted = persisted.sort((a, b) => b.createdAt - a.createdAt)
  return { sessions, activeSessionId: sorted[0].id }
}
