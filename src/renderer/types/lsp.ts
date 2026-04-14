// ─── LSP (Language Server Protocol) ──────────────────────────────────────────

export type LspServerStatus = 'stopped' | 'starting' | 'indexing' | 'ready' | 'error'

/** A single language server config — either built-in or user-defined */
export interface LspServerConfig {
  /** Unique key e.g. "typescript", "rust", "go", "python", or user-chosen */
  id: string
  /** Human label shown in UI */
  label: string
  /** Shell command to run the server */
  command: string
  /** Arguments passed to command */
  args: string[]
  /** File extensions this server handles e.g. ["ts", "tsx", "js", "jsx"] */
  extensions: string[]
  /** Files whose presence triggers auto-detect e.g. ["tsconfig.json", "package.json"] */
  detectFiles: string[]
  /** LSP languageId e.g. "typescript" */
  languageId: string
  /** Whether this is a built-in config (cannot be deleted, only overridden) */
  builtin?: boolean
  /** Ordered list of install methods — first one whose prereq binary is on PATH is used */
  installCandidates?: LspInstallCandidate[]
  /** Fallback hint shown when no prereq is available (e.g. "Install Go at go.dev/dl") */
  installHint?: string
}

/** One possible way to install a language server — command-based or direct binary download */
export type LspInstallCandidate =
  | {
      type: 'command'
      /** Binary that must exist on PATH (e.g. "npm", "brew", "rustup") */
      prereq: string
      /** Full command + args to run */
      command: string[]
      /** Short label shown in UI, e.g. "npm", "Homebrew", "rustup" */
      label: string
    }
  | {
      type: 'download'
      /** URLs keyed by "platform-arch" (e.g. "darwin-arm64", "darwin-x64") or "*" for any */
      urls: Record<string, string>
      /** Decompression needed after download */
      decompress?: 'gz'
      /** Short label shown in UI, e.g. "GitHub Releases" */
      label: string
    }

/** Result of detectServers — config, install state, and viable install method */
export interface LspDetectedServer {
  config: LspServerConfig
  /** Binary found on PATH — server can start immediately */
  installed: boolean
  /** Label of the first viable installer (prereq on PATH); undefined means no installer available */
  installVia?: string
  /** Nearest ancestor directory containing one of config.detectFiles (set by detectServersForFile) */
  resolvedRoot?: string
}

/** Live status of a running or stopped server */
export interface LspServerHandle {
  configId: string
  languageId: string
  projectRoot: string
  status: LspServerStatus
  error?: string
}

/** Per-file diagnostic entry — maps directly to Monaco IMarkerData */
export interface LspDiagnostic {
  startLine: number     // 0-based
  startCol: number
  endLine: number
  endCol: number
  message: string
  /** Monaco MarkerSeverity: Error=8, Warning=4, Info=2, Hint=1 */
  severity: 1 | 2 | 4 | 8
  code?: string | number
  source?: string
}

export interface LspHoverResult {
  contents: string  // markdown string
  startLine: number
  startCol: number
  endLine: number
  endCol: number
}

export interface LspLocation {
  filePath: string
  startLine: number
  startCol: number
  endLine: number
  endCol: number
}

export interface LspRenameResult {
  edits: Array<{
    filePath: string
    startLine: number
    startCol: number
    endLine: number
    endCol: number
    newText: string
  }>
}
