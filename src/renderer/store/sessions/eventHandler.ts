// ---------------------------------------------------------------------------
// Agent IPC event dispatcher — thin coordinator, delegates to handlers/
// ---------------------------------------------------------------------------

import * as ipc from '@/lib/ipc'
import { useSessionsStore } from './store'
import { handleInit, handleSlashCommands, handleSystemInit } from './handlers/handleLifecycle'
import { handleSystemStatus, handleCompactBoundary } from './handlers/handleCompaction'
import { handleDone } from './handlers/handleDone'
import { handleWaitingInput, handleError } from './handlers/handleWaiting'
import { handleUser, handleAssistant } from './handlers/handleMessages'
import { handleStreamEvent, handleToolProgress, handleResult } from './handlers/handleStreaming'
import { updateSession } from './stateUtils'
import { flash } from '@/store/flash'
import { useProjectsStore } from '@/store/projects'
import { useRateLimitsStore } from '@/store/rateLimits'
import type { ModelId } from '@/types'

export function initAgentEventListener(): () => void {
  return ipc.agent.onEvent(({ sessionId, event }: { sessionId: string; event: unknown }) => {
    const ev = event as Record<string, unknown>
    const store = useSessionsStore
    const ctx = { store, sessionId }

    if (!store.getState().sessions[sessionId] && ev.type !== 'init') return

    switch (ev.type) {
      case 'init':
        return handleInit(ctx, ev)
      case 'slashCommands':
        return handleSlashCommands(ctx, ev)
      case 'done':
        return void handleDone(
          ctx,
          (id) => store.getState().queuedMessages[id] ?? null,
          (id) => store.setState((s) => {
            const next = { ...s.queuedMessages }
            delete next[id]
            return { queuedMessages: next }
          }),
          (id) => !!store.getState().editingQueueSessions[id]
        )
      case 'waiting_input':
        return handleWaitingInput(ctx, ev)
      case 'error':
        return handleError(ctx, ev)
      case 'user':
        return handleUser(ctx, ev)
      case 'assistant':
        return handleAssistant(ctx, ev)
      case 'tool_progress':
        return handleToolProgress(ctx, ev)
      case 'stream_event':
        return handleStreamEvent(ctx, ev)
      case 'result':
        return handleResult(ctx, ev)
      case 'system':
        if (ev.subtype === 'init') return handleSystemInit(ctx, ev)
        if (ev.subtype === 'status') return handleSystemStatus(ctx, ev)
        if (ev.subtype === 'compact_boundary') return handleCompactBoundary(ctx, ev)
        break
      case 'rate_limit_event': {
        const info = ev.rate_limit_info as Record<string, unknown> | undefined
        if (!info) break
        // The SDK only populates `utilization` when usage is meaningful (typically >= ~25%).
        // When absent, store status only so the UI can show a green "all clear" dot.
        // rateLimitType is optional in the SDK — default to 'five_hour' (the most common window).
        // Use || (not ??) to also catch empty string — ?? only handles null/undefined.
        const rawType = info.rateLimitType
        const rateLimitType = (typeof rawType === 'string' && rawType) ? rawType : 'five_hour'
        const utilization = typeof info.utilization === 'number' ? info.utilization : null
        const rawStatus = info.status as string | undefined
        const VALID_STATUSES = new Set(['allowed', 'allowed_warning', 'rejected'])
        const status = (rawStatus && VALID_STATUSES.has(rawStatus)
          ? rawStatus
          : 'allowed') as 'allowed' | 'allowed_warning' | 'rejected'
        const entry = {
          rateLimitType,
          utilization,
          status,
          resetsAt: typeof info.resetsAt === 'number' ? info.resetsAt : undefined,
          isUsingOverage: typeof info.isUsingOverage === 'boolean' ? info.isUsingOverage : undefined,
          updatedAt: Date.now()
        }
        // Update global store (account-wide, not per-session) so all UI reacts
        useRateLimitsStore.getState().update(entry)
        break
      }
      case 'elicitation_complete': {
        const session = store.getState().sessions[sessionId]
        if (session?.pendingElicitation) {
          updateSession(store, sessionId, () => ({ pendingElicitation: undefined }))
        }
        break
      }
      case 'braid_worktree_created': {
        flash('success', `Worktree created for branch "${(ev.payload as Record<string, unknown>)?.branch ?? 'unknown'}"`)
        // Refresh all projects so the new worktree appears in the sidebar
        const projects = useProjectsStore.getState().projects
        for (const p of projects) useProjectsStore.getState().refreshWorktrees(p.id)
        break
      }
      case 'braid_session_created': {
        const p = ev.payload as Record<string, unknown>
        const worktreePath = p?.worktreePath as string | undefined
        const prompt = p?.prompt as string | undefined
        const model = p?.model as string | undefined
        const sessionName = (p?.sessionName as string) ?? 'Delegated Task'

        if (!worktreePath || !prompt) {
          flash('error', 'Delegated session failed: missing worktreePath or prompt')
          break
        }

        // Look up worktreeId from worktreePath via projects store
        const projectState = useProjectsStore.getState()
        let worktreeId: string | undefined
        for (const proj of projectState.projects) {
          const wt = proj.worktrees.find((w) => w.path === worktreePath)
          if (wt) { worktreeId = wt.id; break }
        }
        if (!worktreeId) {
          flash('error', `Delegated session failed: no worktree found for ${worktreePath}`)
          break
        }

        // Create session, configure, and start
        const newId = store.getState().createSession(worktreeId, worktreePath)

        // createSession sets activeSessionId — restore focus to the originating session
        store.getState().setActiveSession(sessionId)

        // Keep in sync with ModelId in types/index.ts
        const validModels: string[] = ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5-20251001']
        if (model && validModels.includes(model)) {
          store.getState().updateModel(newId, model as ModelId)
        }

        store.getState().renameSession(newId, sessionName)
        store.getState().sendMessage(newId, prompt).catch((err) => {
          console.error('[Braid] Failed to start delegated session:', err)
          flash('error', `Session "${sessionName}" failed to start`)
        })

        flash('success', `Session "${sessionName}" started on ${worktreePath}`)
        break
      }
    }
  })
}
