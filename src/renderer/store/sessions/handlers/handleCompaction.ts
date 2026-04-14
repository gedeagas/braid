// ---------------------------------------------------------------------------
// Compaction handlers - system status + compact boundary events
// ---------------------------------------------------------------------------

import type { HandlerContext } from './types'
import { updateSession, msgId } from '../stateUtils'
import { persistSession } from '../persistence'
import { compactingActivity } from '../activity'
import { formatTokens } from '@/lib/constants'
import i18n from '@/lib/i18n'

const t = (key: string, opts?: Record<string, unknown>): string =>
  i18n.t(key, { ns: 'center', ...opts })

/**
 * Module-level map: sessionId -> pre-compact token count.
 * Set when compact_boundary arrives, consumed by handleStreamEvent
 * on the next message_start to build the "Compacted: 180k -> 45k" label.
 */
export const preCompactTokens = new Map<string, number>()

/**
 * Handle `system` + `subtype: status` - SDK status changes.
 * When `status === 'compacting'`, sets the activity indicator.
 * When `status === null`, clears it (next SDK event sets the real activity).
 */
export function handleSystemStatus(ctx: HandlerContext, ev: Record<string, unknown>): void {
  const status = ev.status as string | null

  if (status === 'compacting') {
    updateSession(ctx.store, ctx.sessionId, () => ({
      activity: compactingActivity()
    }))
  }
  // status === null: no-op. The next stream_event / tool_progress will set activity.
}

/**
 * Handle `system` + `subtype: compact_boundary` - marks the point where
 * conversation history was compacted. Inserts a visual boundary message.
 * Stashes pre_tokens so the next message_start can build a before->after label.
 */
export function handleCompactBoundary(ctx: HandlerContext, ev: Record<string, unknown>): void {
  const metadata = ev.compact_metadata as { trigger?: string; pre_tokens?: number } | undefined
  const trigger = metadata?.trigger ?? 'manual'
  const preTokens = metadata?.pre_tokens

  // Stash pre_tokens so the next message_start can build the before->after label
  if (preTokens != null) {
    preCompactTokens.set(ctx.sessionId, preTokens)
  }

  // Initial label (will be patched when message_start arrives with post-compact size)
  const content = trigger === 'auto' && preTokens != null
    ? t('compactBoundaryAuto', { tokens: formatTokens(preTokens) })
    : t('compactBoundaryManual')

  updateSession(ctx.store, ctx.sessionId, (current) => ({
    messages: [...current.messages, {
      id: msgId('compact'),
      role: 'system' as const,
      content,
      tag: 'compact-boundary',
      timestamp: Date.now()
    }]
  }))
  persistSession(ctx.sessionId)
}
