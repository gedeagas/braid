/** Session state tracked per active Claude session. */
export interface SessionState {
  sdkSessionId?: string
  abortController?: AbortController
  cwd: string
  model: string
  extendedContext?: boolean
  effortLevel?: string
  sessionName: string
  additionalDirectories?: string[]
  linkedWorktreeContext?: string
  /** Linked worktree context baked into the system prompt at session start. */
  initialLinkedContext?: string
  /** When set, the mobile-device MCP server is injected into the SDK session. */
  connectedDeviceId?: string
  /** Detected mobile framework — enables framework-specific MCP tools. */
  mobileFramework?: string
  /** Stable worktree ID — used by the Braid MCP server for notes file path. */
  worktreeId?: string
  /** Project name — used by the Braid MCP server for worktree creation paths. */
  projectName?: string
  /** Whether RTK awareness was already injected into this session's system prompt. */
  rtkAwarenessInjected?: boolean
}

/** Slash command descriptor returned by the SDK. */
export interface SlashCommand {
  name: string
  description: string
  argumentHint?: string
  source: 'builtin' | 'skill'
}

/** Settings the worker needs — passed as parameters, never imported directly. */
export interface AgentSettings {
  apiKey: string | null
  systemPromptSuffix: string
  /** User-configured absolute path to the SDK's cli.js. Overrides auto-detection. */
  claudeCodeExecutablePath: string
  /**
   * When true, every non-denied tool runs without a confirmation prompt (current
   * default behaviour).  When false, tools not in the allow list pause the agent
   * and ask the user to allow or deny before executing.
   */
  bypassPermissions: boolean
  /** When true, Bash tool output is compressed via RTK binary. */
  outputCompression: boolean
  /** When true, RTK rewrite decisions are logged for debugging. */
  rtkDebug: boolean
}

/**
 * Events emitted by AgentWorker → consumed by AgentCoordinator.
 * This is the serializable boundary between the two layers.
 */
export type WorkerEvent =
  | { type: 'sdk_message'; sessionId: string; message: unknown }
  | {
      type: 'init'
      sessionId: string
      sdkSessionId: string
      slashCommands: Array<{ name: string; source: 'builtin' | 'skill' }>
    }
  | { type: 'slash_commands'; sessionId: string; commands: SlashCommand[] }
  | { type: 'done'; sessionId: string }
  | { type: 'error'; sessionId: string; message: string; errorKind?: 'auth' | 'generic'; authType?: 'oauth' | 'api_key' | 'unknown' }
  | {
      type: 'waiting_input'
      sessionId: string
      reason: 'question' | 'plan_approval'
    }
  | {
      type: 'waiting_input'
      sessionId: string
      reason: 'tool_permission'
      toolName: string
      toolInput: Record<string, unknown>
      toolUseId: string
      /** Human-readable display name from the CLI (e.g. "Read file") */
      displayName?: string
      /** Short description from the CLI */
      description?: string
    }
  | {
      type: 'waiting_input'
      sessionId: string
      reason: 'elicitation'
      serverName: string
      message: string
      mode?: 'form' | 'url'
      url?: string
      elicitationId?: string
      requestedSchema?: Record<string, unknown>
    }
  | { type: 'elicitation_complete'; sessionId: string; serverName: string }
  | {
      type: 'braid_action'
      sessionId: string
      action: 'worktree_created' | 'create_session' | 'data_request'
      payload: Record<string, unknown>
    }
