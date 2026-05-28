// ---------------------------------------------------------------------------
// Worktree sync side effect - trigger refresh after CLI commands that mutate state
// Pure parsing logic separated from store side effect for testability
// ---------------------------------------------------------------------------

import type { ToolCall } from '@/types'
import type { ToolResultPatch, WorktreeSyncDeps } from './types'
import { classifyCliRefreshCommand, mergeCliRefreshPlans, type CliRefreshPlan } from '@/lib/cliRefresh'
import { requestWorktreeRefresh } from '@/lib/worktreeRefresh'

// ---------------------------------------------------------------------------
// Pure: detect whether a refresh-triggering CLI command was just executed
// ---------------------------------------------------------------------------

interface ToolCliRefreshTrigger {
  command: string
  plan: CliRefreshPlan
}

/**
 * Given the result patches from a user event and the tool calls they reference,
 * returns the Bash command string if a refresh-triggering command was executed.
 *
 * Pure function: no state access, no side effects.
 * Returns null when no sync is needed.
 */
export function findSyncTriggerCommand(
  patches: Pick<ToolResultPatch, 'toolUseId'>[],
  toolCalls: ToolCall[]
): string | null {
  return findCliRefreshTrigger(patches, toolCalls)?.command ?? null
}

export function findCliRefreshTrigger(
  patches: Pick<ToolResultPatch, 'toolUseId'>[],
  toolCalls: ToolCall[]
): ToolCliRefreshTrigger | null {
  const commands: string[] = []
  let mergedPlan: CliRefreshPlan | null = null
  for (const patch of patches) {
    const tc = toolCalls.find((t) => t.id === patch.toolUseId)
    if (tc?.name !== 'Bash') continue

    let cmd = ''
    try {
      cmd = (JSON.parse(tc.input) as Record<string, unknown>).command as string
    } catch {
      continue
    }

    if (!cmd) continue
    const plan = classifyCliRefreshCommand(cmd)
    if (!plan) continue
    commands.push(cmd)
    mergedPlan = mergeCliRefreshPlans(mergedPlan, plan)
  }
  return mergedPlan ? { command: commands.join('\n'), plan: mergedPlan } : null
}

// ---------------------------------------------------------------------------
// Side effect: refresh worktree if triggered
// ---------------------------------------------------------------------------

/**
 * Fire-and-forget: if the patches include a mutating git/gh/acli command,
 * refresh the affected resource keys for the owning worktree.
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
  const trigger = findCliRefreshTrigger(patches, toolCalls)
  if (!trigger) return

  const worktreePath = deps.getWorktreePath(sessionId)
  if (!worktreePath) return

  if (trigger.plan.invalidateJiraCache) {
    void deps.invalidateJiraCache?.()
  }

  requestWorktreeRefresh(worktreePath, trigger.plan.resources, {
    reason: trigger.plan.reason,
    force: trigger.plan.force,
  })

  if (trigger.plan.refreshWorktrees) {
    const project = deps.findProjectByWorktreePath(worktreePath)
    if (project) deps.refreshWorktrees(project.id).catch(() => {})
  }
}
