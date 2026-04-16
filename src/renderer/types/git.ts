import type { LspServerConfig } from './lsp'
import type { AgentSession } from './session'

// ─── Project / Worktree ───────────────────────────────────────────────────────

export type ScriptSource = 'npm' | 'yarn' | 'pnpm' | 'bun' | 'makefile' | 'cargo' | 'go' | 'composer' | 'python' | 'custom'

export interface RunCommand {
  id: string
  name: string
  command: string
  source: ScriptSource
}

export interface ProjectSettings {
  workspacesPath: string
  defaultBaseBranch: string
  branchPrefix: string
  remoteOrigin: string
  setupScript: string    // multiline bash script
  runScript: string      // multiline bash script
  archiveScript: string  // multiline bash script
  copyFiles: string[]    // relative paths to copy on worktree creation
  runFavorites: string[]       // favorite script IDs pinned to top
  runCustomCommands: RunCommand[]  // user-defined commands persisted per project
  /** User-defined or overridden LSP server configs for this project */
  lspServers?: LspServerConfig[]
  /** Disable LSP entirely for this project */
  lspDisabled?: boolean
}

export type ProjectPlatform = 'mobile' | 'web' | 'unknown'
export type MobileFramework = 'react-native' | 'flutter' | null

export interface Project {
  id: string
  name: string
  path: string // absolute path to the git repo
  worktrees: Worktree[]
  createdAt: number
  settings?: ProjectSettings
  /** GitHub org/user avatar URL, fetched automatically */
  avatarUrl?: string
  /** Detected platform — 'mobile' shows the Simulator tab */
  platform?: ProjectPlatform
  /** Detected mobile framework — enables framework-specific debug controls */
  mobileFramework?: MobileFramework
}

export interface Worktree {
  id: string
  projectId: string
  branch: string
  path: string // absolute path to the worktree directory
  isMain: boolean // true for the main repo checkout
  upstream?: string // e.g. "origin/main"
  sessions: AgentSession[]
}

export interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  children?: FileEntry[]
}

export interface GitChange {
  file: string
  status: 'M' | 'A' | 'D' | '?' | 'R'
  staged: boolean
  diff?: string
}
