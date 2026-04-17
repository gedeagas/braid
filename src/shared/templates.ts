/**
 * Shared types for the templates IPC channel.
 *
 * Lives in src/shared/ so main, preload, and renderer can all import the same
 * union literals without drift. Keep this file dependency-free.
 */

export type TemplateKind = 'nextjs'

export interface CreateTemplateArgs {
  parentDir: string
  projectName: string
}

/**
 * Classified failure reasons. The renderer maps each to a specific i18n
 * string so users see an actionable message instead of a generic "failed".
 */
export type CreateFailureReason =
  | 'invalid-name'
  | 'missing-parent'
  | 'parent-not-directory'
  | 'tool-missing'
  | 'timeout'
  | 'cancelled'
  | 'failed'

export type CreateTemplateResult =
  | { success: true }
  | { success: false; reason: CreateFailureReason; stderr?: string }

export type LogStream = 'stdout' | 'stderr'

export interface TemplateLogEntry {
  stream: LogStream
  /** Single trimmed line; caller is expected to render whitespace-preserved. */
  line: string
}
