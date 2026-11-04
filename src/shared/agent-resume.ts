// ── Agent session resume ─────────────────────────────────────────────────────
//
// When a big terminal's daemon session is gone (reboot, daemon crash, kill),
// replaying scrollback alone leaves a dead shell. Agents report their own
// session id through hooks; persisting it lets a cold restore relaunch the
// agent straight back into the same conversation.
//
// Everything here treats ids and paths as untrusted: they come from hook
// payloads and from localStorage, and end up typed into a shell.

/** A resumable agent conversation bound to a big terminal tab. */
export interface AgentResumeSession {
  /** Hook agent id that reported the session (authoritative over the tab's agentId). */
  agent: string
  /** Provider session / conversation id. */
  id: string
  /** Folder the agent ran in, when reported. Sessions are scoped to it. */
  cwd?: string
}

/** CLI arguments that resume a given session, per agent. */
const RESUME_ARGS: Record<string, (id: string) => string[]> = {
  claude: (id) => ['--resume', id],
  codex: (id) => ['resume', id],
  gemini: (id) => ['--resume', id],
  cursor: (id) => ['--resume', id],
  // Copilot documents the joined spelling.
  copilot: (id) => [`--resume=${id}`],
  grok: (id) => ['--resume', id],
  droid: (id) => ['--resume', id],
  hermes: (id) => ['--resume', id],
}

// Conservative charset: covers uuids and prefixed ids (session_<uuid>,
// conv:abc) while making shell or flag injection impossible. A leading dash is
// rejected so an id can never be read as a flag.
const SESSION_ID_RE = /^[A-Za-z0-9._:][A-Za-z0-9._:-]{0,255}$/
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/
const MAX_PATH_LENGTH = 4096

export function isResumableAgent(agent: unknown): agent is string {
  return typeof agent === 'string' && Object.hasOwn(RESUME_ARGS, agent)
}

export function normalizeSessionId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const id = raw.trim()
  return SESSION_ID_RE.test(id) ? id : null
}

export function normalizeSessionCwd(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  if (!raw.startsWith('/') || raw.length > MAX_PATH_LENGTH || CONTROL_RE.test(raw)) return null
  return raw.length > 1 && raw.endsWith('/') ? raw.replace(/\/+$/, '') || '/' : raw
}

/** Validate a session read back from storage or IPC. */
export function normalizeResumeSession(raw: unknown): AgentResumeSession | null {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as Record<string, unknown>
  if (!isResumableAgent(record.agent)) return null
  const id = normalizeSessionId(record.id)
  if (!id) return null
  const cwd = normalizeSessionCwd(record.cwd)
  return cwd ? { agent: record.agent, id, cwd } : { agent: record.agent, id }
}

/**
 * Whether a SessionEnd means the user deliberately left the agent, in which
 * case a later cold restore must NOT bring it back. `clear` starts a new
 * session (whose id arrives next), and unknown reasons may be a kill, so both
 * keep the saved session.
 */
export function isDeliberateSessionEnd(agent: string, reason: string | undefined): boolean {
  if (agent !== 'claude') return false
  return reason === 'prompt_input_exit' || reason === 'logout'
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function isInside(child: string, parent: string): boolean {
  const base = parent.endsWith('/') ? parent : `${parent}/`
  return child.startsWith(base)
}

/**
 * Shell command that relaunches the agent into its saved session. `launchCmd`
 * is the catalog launch command (e.g. `hermes --tui`) so per-agent base flags
 * are kept. Returns null when this session can't be resumed safely.
 */
export function buildResumeCommand(
  session: AgentResumeSession,
  launchCmd: string,
  worktreePath: string,
): string | null {
  const args = RESUME_ARGS[session.agent]
  const id = normalizeSessionId(session.id)
  const base = launchCmd.trim()
  if (!args || !id || !base) return null

  const [first, ...rest] = args(id)
  // Flags are fixed literals; only the id-bearing word needs quoting.
  const words = rest.length > 0 ? [first, shellQuote(rest[0])] : [shellQuote(first)]
  const command = `${base} ${words.join(' ')}`

  const cwd = session.cwd ? normalizeSessionCwd(session.cwd) : null
  const worktree = normalizeSessionCwd(worktreePath)
  if (cwd && worktree && cwd !== worktree && isInside(cwd, worktree)) {
    return `cd ${shellQuote(cwd)} && ${command}`
  }
  return command
}

/**
 * Session change reported by a hook, sent main -> renderer on its own channel.
 * `session: null` means the user deliberately exited: forget the saved session.
 */
export interface AgentHookSessionUpdate {
  terminalId: string
  session: AgentResumeSession | null
}

/** Extract a session update from a raw hook request body, or null if none applies. */
export function parseHookSessionUpdate(agent: string, body: unknown): AgentHookSessionUpdate | null {
  if (!isResumableAgent(agent) || typeof body !== 'object' || body === null) return null
  const record = body as Record<string, unknown>
  const terminalId = typeof record.terminalId === 'string' ? record.terminalId : ''
  if (!terminalId) return null

  if (record.event === 'SessionEnd') {
    const reason = typeof record.reason === 'string' ? record.reason : undefined
    return isDeliberateSessionEnd(agent, reason) ? { terminalId, session: null } : null
  }

  const id = normalizeSessionId(record.sessionId)
  if (!id) return null
  const cwd = normalizeSessionCwd(record.cwd)
  return { terminalId, session: cwd ? { agent, id, cwd } : { agent, id } }
}
