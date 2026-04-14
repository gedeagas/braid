/**
 * Type barrel — re-exports all domain types.
 * Import from `@/types` OR from individual domain files (both work).
 *
 * Domain files:
 *   @/types/session.ts       — AgentSession, Message, ToolCall, SessionStatus, …
 *   @/types/git.ts           — Project, Worktree, GitChange, FileEntry, …
 *   @/types/ui.ts            — RightPanelTab, ToastSize, SessionColumnId, …
 *   @/types/claude-config.ts — ClaudePermissions, McpServerEntry, …
 *   @/types/lsp.ts           — LspServerConfig, LspDiagnostic, …
 */

export * from './session'
export * from './git'
export * from './ui'
export * from './claude-config'
export * from './lsp'
