/**
 * Images handed to a chat session from outside ChatView (e.g. a Design Mode
 * pick). ChatView keeps attachments in local state, so producers queue here
 * and the session's ChatView drains the queue when it's (or becomes) active.
 */
const queues = new Map<string, string[]>()
export const CHAT_IMAGES_QUEUED_EVENT = 'braid:chatImagesQueued'

export function queueChatImages(sessionId: string, dataUris: string[]): void {
  if (dataUris.length === 0) return
  queues.set(sessionId, [...(queues.get(sessionId) ?? []), ...dataUris])
  window.dispatchEvent(new CustomEvent(CHAT_IMAGES_QUEUED_EVENT, { detail: { sessionId } }))
}

export function drainChatImages(sessionId: string): string[] {
  const list = queues.get(sessionId) ?? []
  queues.delete(sessionId)
  return list
}
