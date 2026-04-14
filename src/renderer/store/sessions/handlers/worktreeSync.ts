// ---------------------------------------------------------------------------
// Worktree sync side effect — trigger refresh after git push / gh pr create
// Pure parsing logic separated from store side effect for testability
// ---------------------------------------------------------------------------

import type { ToolCall } from '@/types'
import type { ToolResultPatch, WorktreeSyncDeps } from './types'
import { sessionWorktreePaths } from '../storage'
import { useProjectsStore } from '@/store/projects'

// ---------------------------------------------------------------------------
// Pure: detect whether a git push or gh pr create was just executed
// ---------------------------------------------------------------------------

/**
 * Given the result patches from a user event and the tool calls they reference,
 * returns the Bash command string if a sync-triggering command was executed.
 *
 * Pure function: no state access, no side effects.
 * Returns null when no sync is needed.
 */
export function findSyncTriggerCommand(
  patches: Pick<ToolResultPatch, 'toolUseId'>[],
  toolCalls: ToolCall[]
): string | null {
  for (const patch of patches) {
    const tc = toolCalls.find((t) => t.id === patch.toolUseId)
    if (tc?.name !== 'Bash') continue

    let cmd = ''
    try {
      cmd = (JSON.parse(tc.input) as Record<string, unknown>).command as string
    } catch {
      continue
    }

    if (cmd && (cmd.includes('git push') || cmd.includes('gh pr create'))) {
      return cmd
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Side effect: refresh worktree if triggered
// ---------------------------------------------------------------------------

/**
 * Fire-and-forget: if the patches include a git push or gh pr create result,
 * refresh the owning project's worktrees.
 *
 * @param sessionId - Session that executed the tool
 * @param patches - Tool result patches from the user event
 * @param toolCalls - Tool calls from the preceding assistant message
 * @param deps - Injected accessors; pass createWorktreeSyncDeps() in production
 */
export function triggerWorktreeRefreshIfNeeded(
  sessionId: string,
  patches: Pick<ToolResultPatch, 'toolUseId'>[],
  toolCalls: ToolCall[],
  deps: WorktreeSyncDeps
): void {
  const cmd = findSyncTriggerCommand(patches, toolCalls)
  if (!cmd) return

  const worktreePath = deps.getWorktreePath(sessionId)
  if (!worktreePath) return

  const project = deps.findProjectByWorktreePath(worktreePath)
  if (!project) return

  deps.refreshWorktrees(project.id).catch(() => {})
}

// ---------------------------------------------------------------------------
// Production factory
// ---------------------------------------------------------------------------

/**
 * Creates the real WorktreeSyncDeps wired to live stores.
 * Use this in production; pass mock objects in tests.
 */
export function createWorktreeSyncDeps(): WorktreeSyncDeps {
  return {
    getWorktreePath: (sessionId) => sessionWorktreePaths.get(sessionId),
    findProjectByWorktreePath: (wtPath) => {
      const project = useProjectsStore.getState().projects.find((p) =>
        p.worktrees.some((w) => w.path === wtPath)
      )
      return project ? { id: project.id } : undefined
    },
    refreshWorktrees: (projectId) =>
      useProjectsStore.getState().refreshWorktrees(projectId)
  }
}
