import type { SessionColumnId, PrColumnId, SessionStatus } from '@/types'

export interface KanbanColumnDef {
  id: SessionColumnId | PrColumnId
  labelKey: string // i18n key within 'missionControl' namespace
  color: string    // CSS variable reference for column accent
}

/** Sessions auto-expire from Done → Idle after this duration */
export const DONE_EXPIRY_MS = 60 * 60 * 1000 // 1 hour

export const SESSION_COLUMNS: KanbanColumnDef[] = [
  { id: 'idle',            labelKey: 'columnIdle',           color: 'var(--olive)' },
  { id: 'running',         labelKey: 'columnRunning',        color: 'var(--accent)' },
  { id: 'need_attention',  labelKey: 'columnNeedAttention',  color: 'var(--amber)' },
  { id: 'done',            labelKey: 'columnDone',           color: 'var(--text-muted)' },
]

export const PR_COLUMNS: KanbanColumnDef[] = [
  { id: 'pr_open',          labelKey: 'columnPrOpen',          color: 'var(--green)' },
  { id: 'pr_draft',         labelKey: 'columnPrDraft',         color: 'var(--olive)' },
  { id: 'pr_merged_closed', labelKey: 'columnPrMergedClosed',  color: 'var(--text-muted)' },
]

/**
 * Assign a session to a status-based kanban column.
 * Sessions that completed without needing input go straight to done.
 * Done sessions auto-expire to idle after DONE_EXPIRY_MS, or immediately
 * when the user clears the done column (doneLastClearedAt).
 *
 * Dismissed error/waiting_input sessions follow the same expiry and clear
 * rules — using their dismiss timestamp instead of runCompletedAt.
 */
export function assignSessionColumn(
  status: SessionStatus,
  runCompletedAt: number | null,
  dismissedAt: number | null,
  now = Date.now(),
  doneLastClearedAt: number | null = null
): SessionColumnId {
  if (status === 'running') return 'running'
  if (status === 'waiting_input' || status === 'error') {
    if (dismissedAt == null) return 'need_attention'
    // Dismissed → done, but respect clear & auto-expiry
    if (doneLastClearedAt != null && dismissedAt <= doneLastClearedAt) return 'idle'
    if (now - dismissedAt >= DONE_EXPIRY_MS) return 'idle'
    return 'done'
  }
  if (status === 'idle' && runCompletedAt != null) {
    if (now - runCompletedAt >= DONE_EXPIRY_MS) return 'idle'
    if (doneLastClearedAt != null && runCompletedAt <= doneLastClearedAt) return 'idle'
    return 'done'
  }
  return 'idle'
}

/**
 * Assign a PR to a PR-based kanban column.
 */
export function assignPrColumn(prState: string, isDraft: boolean): PrColumnId {
  if (prState === 'MERGED' || prState === 'CLOSED') return 'pr_merged_closed'
  if (isDraft) return 'pr_draft'
  return 'pr_open'
}

/**
 * Compute the highest-priority session status from a list of sessions.
 * Priority: running > waiting_input > error > idle > inactive
 */
export function computeTopStatus(
  statuses: SessionStatus[]
): SessionStatus {
  if (statuses.some((s) => s === 'running')) return 'running'
  if (statuses.some((s) => s === 'waiting_input')) return 'waiting_input'
  if (statuses.some((s) => s === 'error')) return 'error'
  if (statuses.some((s) => s === 'idle')) return 'idle'
  return 'inactive'
}
