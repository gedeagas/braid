// ---------------------------------------------------------------------------
// Periodic flush — push buffered streaming text to the UI every 150ms
// ---------------------------------------------------------------------------

import { useSessionsStore } from './store'

const FLUSH_INTERVAL_MS = 150
const flushTimers = new Map<string, ReturnType<typeof setInterval>>()

export function startPeriodicFlush(sessionId: string): void {
  if (flushTimers.has(sessionId)) return
  const timer = setInterval(() => {
    const buffered = useSessionsStore.getState().streamingTextBuffers[sessionId]
    if (buffered) flushStreamingBuffer(sessionId)
  }, FLUSH_INTERVAL_MS)
  flushTimers.set(sessionId, timer)
}

export function stopPeriodicFlush(sessionId: string): void {
  const timer = flushTimers.get(sessionId)
  if (timer) {
    clearInterval(timer)
    flushTimers.delete(sessionId)
  }
}

/** Flush buffered streaming text into the partial message so it becomes visible */
export function flushStreamingBuffer(sessionId: string): void {
  const state = useSessionsStore.getState()
  const buffered = state.streamingTextBuffers[sessionId]
  if (!buffered) return

  const current = state.sessions[sessionId]
  if (!current) {
    // Session was removed — discard orphaned buffer and stop any lingering timer
    stopPeriodicFlush(sessionId)
    const { [sessionId]: _, ...restBuffers } = state.streamingTextBuffers
    useSessionsStore.setState({ streamingTextBuffers: restBuffers })
    return
  }

  const messages = [...current.messages]
  const lastMsg = messages[messages.length - 1]
  if (lastMsg?.role === 'assistant' && lastMsg.isPartial) {
    messages[messages.length - 1] = {
      ...lastMsg,
      content: lastMsg.content + buffered
    }
  }

  const { [sessionId]: _, ...restBuffers } = state.streamingTextBuffers
  useSessionsStore.setState({
    sessions: { ...state.sessions, [sessionId]: { ...current, messages } },
    streamingTextBuffers: restBuffers
  })
}
