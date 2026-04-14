// ---------------------------------------------------------------------------
// Barrel re-exports — preserves the public API of the sessions store
// ---------------------------------------------------------------------------

export { useSessionsStore } from './store'
export type { SessionsState, QueuedMessage } from './store'
export { useSessionsForWorktree, useActiveSession, useLinkedWorktrees, getLastActiveForWorktree } from './selectors'
export { initAgentEventListener } from './eventHandler'
