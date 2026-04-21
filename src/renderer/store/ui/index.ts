// ─── Public API ───────────────────────────────────────────────────────────────
// Re-export everything consumers need from @/store/ui

export { useUIStore } from './store'

// Types used by consumers
export type { UIState } from './types'
export type { CenterView, ToolMessageStyle, ActivityIndicatorStyle, DiffFileSelection, GitStatusCode } from './layout'
export { selectChangesOpen, selectSelectedDiffFile, selectActiveCenterView, selectCodeReviewOpen } from './layout'
export type { SupportedLanguage } from './theme'
