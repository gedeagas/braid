import type { AgentSession } from '@/types'
import i18n from '@/lib/i18n'

/**
 * Compute a display title for a session.
 * Priority: customName → AI-generated name → first user message → default
 * Activity strings (e.g. "Writing…") are NOT used here — they're shown in ActivityIndicator.
 */
export function getSessionTitle(session: AgentSession): string {
  if (session.customName) return session.name
  // AI-generated name (name was updated but not by user)
  if (session.name && session.name !== 'New Chat') return session.name
  const firstUserMsg = session.messages.find((m) => m.role === 'user')
  if (firstUserMsg) {
    const text = firstUserMsg.content.trim()
    return text.length > 30 ? text.slice(0, 30) + '\u2026' : text
  }
  return i18n.t('newChatDefault', { ns: 'center' })
}
