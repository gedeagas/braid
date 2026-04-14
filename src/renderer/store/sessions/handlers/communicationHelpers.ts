// ---------------------------------------------------------------------------
// Pure helpers for communication actions — no store dependencies
// ---------------------------------------------------------------------------

import type { LinkedWorktree } from '@/types'

/** Build a system-prompt-ready description of linked worktrees. */
export function buildLinkedWorktreeContext(linked?: LinkedWorktree[]): string | undefined {
  if (!linked || linked.length === 0) return undefined
  return linked
    .map((lw) => `- ${lw.path} (branch: ${lw.branch}, project: ${lw.projectName})`)
    .join('\n')
}
