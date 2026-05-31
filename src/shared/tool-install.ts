export const TOOL_INSTALL_KEYS = ['git', 'gh', 'claude', 'acli', 'mobilecli'] as const

export type ToolInstallKey = typeof TOOL_INSTALL_KEYS[number]

export type ToolInstallReason =
  | 'already_installed'
  | 'installed'
  | 'unknown_tool'
  | 'unsupported_platform'
  | 'missing_prerequisite'
  | 'admin_required'
  | 'install_failed'
  | 'postcheck_failed'
  | 'manual_completion_required'

export interface ToolInstallResult {
  key: string
  success: boolean
  installed: boolean
  reason: ToolInstallReason
  message: string
  prerequisite?: string
  targetPath?: string
  requiresAdmin?: boolean
}

export interface ToolInstallOptions {
  allowAdmin?: boolean
}

const TOOL_INSTALL_KEY_SET = new Set<string>(TOOL_INSTALL_KEYS)

export function isToolInstallKey(value: string): value is ToolInstallKey {
  return TOOL_INSTALL_KEY_SET.has(value)
}
