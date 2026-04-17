// ─── Agent backend ────────────────────────────────────────────────────────────

/** Model descriptor returned by an ACP agent during session/new. */
export interface AcpModelInfo {
  modelId: string
  name: string
  description?: string
}

/** Identifies which agent backend a session uses. */
export type AgentBackend =
  | { type: 'claude-sdk' }
  | {
      type: 'acp'
      availableModels?: AcpModelInfo[]
      currentModelId?: string
    }

// ─── Session ──────────────────────────────────────────────────────────────────

export type SessionStatus = 'idle' | 'running' | 'waiting_input' | 'error' | 'inactive'
export type ModelId = 'claude-opus-4-7' | 'claude-sonnet-4-6' | 'claude-opus-4-6' | 'claude-haiku-4-5-20251001'
export type EffortLevel = 'low' | 'medium' | 'high' | 'max'
export type SettingsSection = string

export interface PendingQuestion {
  toolUseId: string
  questions: Array<{
    question: string
    header: string
    options: Array<{ label: string; description: string }>
    multiSelect: boolean
  }>
}

export interface PendingPlanApproval {
  toolUseId: string
  planFilePath?: string // absolute path to the plan file written before ExitPlanMode
}

export interface PendingToolPermission {
  toolUseId: string
  toolName: string
  toolInput: Record<string, unknown>
  displayName?: string
  description?: string
}

export type AuthErrorType = 'oauth' | 'api_key' | 'unknown'

export interface PendingAuthError {
  message: string
  authType: AuthErrorType
}

export interface PendingElicitation {
  /** MCP server requesting authentication */
  serverName: string
  /** Message to display */
  message: string
  /** 'url' for browser-based OAuth, 'form' for structured input */
  mode?: 'form' | 'url'
  /** URL to open in browser (url mode only) */
  url?: string
  /** Correlation ID for url mode completion */
  elicitationId?: string
  /** JSON Schema for form fields (form mode only) */
  requestedSchema?: Record<string, unknown>
}

export interface LinkedWorktree {
  worktreeId: string
  projectId: string
  projectName: string
  branch: string
  path: string // absolute filesystem path
}

export interface AgentSession {
  id: string
  worktreeId: string
  name: string
  customName: boolean // true only when the user has explicitly renamed the tab
  sdkSessionId?: string // from SDK for resume
  status: SessionStatus
  model: ModelId
  thinkingEnabled: boolean
  extendedContext: boolean
  effortLevel: EffortLevel
  planModeEnabled: boolean
  messages: Message[]
  activity: string | null // e.g. "Thinking...", "Running Bash", "Reading file"
  runStartedAt: number | null // Date.now() when run begins, null when idle
  runCompletedAt: number | null // Date.now() when run finishes, null while running or before first run
  totalRunDurationMs: number // accumulated ms of completed runs (survives across restarts)
  tokenUsage: { input: number; output: number } | null // cumulative across turns
  contextTokens: number | null // latest turn's input_tokens (actual context window usage)
  createdAt: number
  pendingQuestion?: PendingQuestion
  pendingPlanApproval?: PendingPlanApproval
  pendingToolPermission?: PendingToolPermission
  pendingAuthError?: PendingAuthError
  pendingElicitation?: PendingElicitation
  slashCommands?: SlashCommand[]
  linkedWorktrees?: LinkedWorktree[]
  /** When set, the mobile-device MCP server is injected into this session. */
  connectedDeviceId?: string
  /** Agent backend for this session. Omitted = claude-sdk (backward compat). */
  backend?: AgentBackend
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; toolCall: ToolCall }

export interface TurnUsage {
  model?: string // raw model id from API (e.g. "claude-sonnet-4-6-20250514")
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  images?: string[] // base64 data URIs for user-attached images
  toolCalls?: ToolCall[]
  blocks?: ContentBlock[] // ordered content blocks preserving text/tool interleaving
  isPartial?: boolean
  tag?: string // optional semantic tag (e.g. 'create-pr') for special renderers
  timestamp: number
  turnDurationMs?: number // wall-clock duration for this assistant turn
  turnUsage?: TurnUsage // per-turn token usage snapshot
}

export interface ToolCall {
  id: string
  name: string
  input: string
  result?: string
  filePath?: string // short display name (last 2 segments)
  filePathFull?: string // full absolute path from tool input
  diffStats?: { additions: number; deletions: number }
  error?: string // tool execution error
  startedAt?: number // Date.now() when tool_use block first appears
  completedAt?: number // Date.now() when result/error arrives
}

export interface SlashCommand {
  name: string
  description: string
  /** Argument hint shown after the command name, e.g. "<file>" or "-m <message>" */
  argumentHint?: string
  /** 'builtin' = SDK built-in command, 'skill' = user-installed skill */
  source: 'builtin' | 'skill'
}

export interface AttachedFile {
  /** Relative path within the worktree (e.g., "src/main/ipc.ts") */
  path: string
  /** File content, loaded when the file is selected */
  content: string
}

export interface SnippetAttachment {
  id: string
  content: string
  /** First non-empty line, truncated to 80 chars */
  firstLine: string
  lineCount: number
  charCount: number
}

export interface DiffComment {
  id: string
  /** Relative file path within the worktree */
  file: string
  /** Start line number (newNo for add/ctx, oldNo for del) */
  line: number
  /** End line number for multiline selections (same as `line` when omitted) */
  endLine?: number
  lineType: 'add' | 'del' | 'ctx'
  /** The actual code content on the first line */
  lineContent: string
  /** All selected line contents (multiline). Falls back to [lineContent] when absent. */
  lineContents?: string[]
  /** User's comment text */
  text: string
  createdAt: number
}

// ─── Jira ─────────────────────────────────────────────────────────────────────

export interface JiraIssue {
  key: string
  summary: string
  /** Human-readable status name, e.g. "In Progress" */
  status: string
  /** Jira status category key: new = to-do, indeterminate = in-progress, done = done */
  statusCategory: 'new' | 'indeterminate' | 'done'
  type: string
  assignee: string | null
  url: string
}

export interface JiraResult {
  /** false when acli is not installed */
  available: boolean
  issues: JiraIssue[]
}
