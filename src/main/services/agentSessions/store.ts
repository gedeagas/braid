// ── Durable agent session records ────────────────────────────────────────────
//
// Which agent conversation last ran in each big terminal, so a cold restore
// (reboot, daemon crash, kill) can relaunch it. Owned by the main process
// because hooks land here even when no window is open, and written to disk so
// it outlives the app. The file is read back as untrusted input: session ids
// end up typed into a shell.

import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import {
  normalizeResumeSession,
  type AgentHookSessionUpdate,
  type AgentResumeSession,
} from '../../../shared/agent-resume'

const FILE_VERSION = 1
export const MAX_RECORD_AGE_MS = 7 * 24 * 60 * 60 * 1000
const DEFAULT_SAVE_DELAY_MS = 5_000
const TERMINAL_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/
const STATES = new Set(['working', 'blocked', 'waiting', 'done'])

export type AgentRecordState = 'working' | 'blocked' | 'waiting' | 'done'

export interface AgentSessionRecord {
  terminalId: string
  session: AgentResumeSession
  /** Last hook-reported status, shown until a live hook confirms it again. */
  state?: AgentRecordState
  updatedAt: number
  /** `quit`: the app quit while this agent was recorded (stamped on before-quit). */
  origin: 'live' | 'quit'
}

export interface AgentSessionStoreOptions {
  filePath: string
  now?: () => number
  saveDelayMs?: number
}

function normalizeRecord(raw: unknown, now: number): AgentSessionRecord | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.terminalId !== 'string' || !TERMINAL_ID_RE.test(r.terminalId)) return null
  const session = normalizeResumeSession(r.session)
  if (!session) return null
  const updatedAt = typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt) ? r.updatedAt : 0
  if (now - updatedAt > MAX_RECORD_AGE_MS) return null
  const record: AgentSessionRecord = {
    terminalId: r.terminalId,
    session,
    updatedAt,
    origin: r.origin === 'quit' ? 'quit' : 'live',
  }
  if (typeof r.state === 'string' && STATES.has(r.state)) record.state = r.state as AgentRecordState
  return record
}

export class AgentSessionStore {
  private records = new Map<string, AgentSessionRecord>()
  /** Provider session (agent:id) -> terminal that resumed it in this app run. */
  private claimedBy = new Map<string, string>()
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private readonly filePath: string
  private readonly now: () => number
  private readonly saveDelayMs: number

  constructor(opts: AgentSessionStoreOptions) {
    this.filePath = opts.filePath
    this.now = opts.now ?? Date.now
    this.saveDelayMs = opts.saveDelayMs ?? DEFAULT_SAVE_DELAY_MS
  }

  /** Load records from disk, dropping anything invalid or expired. */
  load(): void {
    this.records.clear()
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(this.filePath, 'utf8'))
    } catch {
      return
    }
    if (typeof parsed !== 'object' || parsed === null) return
    const file = parsed as { version?: unknown; records?: unknown }
    if (file.version !== FILE_VERSION || typeof file.records !== 'object' || file.records === null) return
    const now = this.now()
    for (const raw of Object.values(file.records as Record<string, unknown>)) {
      const record = normalizeRecord(raw, now)
      if (record) this.records.set(record.terminalId, record)
    }
  }

  get(terminalId: string): AgentSessionRecord | null {
    return this.records.get(terminalId) ?? null
  }

  list(): AgentSessionRecord[] {
    return [...this.records.values()]
  }

  /** Apply a hook-reported session change. `session: null` is a deliberate exit. */
  applySessionUpdate(update: AgentHookSessionUpdate): void {
    if (!TERMINAL_ID_RE.test(update.terminalId)) return
    if (update.session === null) {
      if (this.records.delete(update.terminalId)) this.scheduleSave()
      return
    }
    const session = normalizeResumeSession(update.session)
    if (!session) return
    const prev = this.records.get(update.terminalId)
    this.records.set(update.terminalId, {
      terminalId: update.terminalId,
      session,
      state: prev?.state,
      updatedAt: this.now(),
      origin: 'live',
    })
    this.scheduleSave()
  }

  /** Remember the last hook status for a terminal that already has a session. */
  noteState(terminalId: string, state: string): void {
    const record = this.records.get(terminalId)
    if (!record || !STATES.has(state) || record.state === state) return
    record.state = state as AgentRecordState
    this.scheduleSave()
  }

  forget(terminalId: string): void {
    if (this.records.delete(terminalId)) this.scheduleSave()
  }

  /** Drop records for terminals the app no longer tracks (tab closed elsewhere). */
  retainOnly(knownTerminalIds: ReadonlySet<string>): void {
    let changed = false
    for (const id of this.records.keys()) {
      if (!knownTerminalIds.has(id)) {
        this.records.delete(id)
        changed = true
      }
    }
    if (changed) this.scheduleSave()
  }

  /**
   * The session to resume in this terminal, or null. A provider session is
   * handed to one terminal per app run, so two tabs that both recorded it
   * (duplicated tab, same conversation reopened) don't both relaunch it.
   */
  claimResume(terminalId: string): AgentResumeSession | null {
    const record = this.records.get(terminalId)
    if (!record) return null
    const key = `${record.session.agent}:${record.session.id}`
    const owner = this.claimedBy.get(key)
    if (owner && owner !== terminalId) return null
    this.claimedBy.set(key, terminalId)
    return { ...record.session }
  }

  /** Stamp every record as captured at quit and write synchronously. */
  markQuitAndFlush(): void {
    for (const record of this.records.values()) record.origin = 'quit'
    this.flush()
  }

  /** Write now (atomic: tmp file + rename). Best effort. */
  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    const tmp = `${this.filePath}.tmp`
    try {
      mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 })
      const records = Object.fromEntries([...this.records].map(([id, r]) => [id, r]))
      writeFileSync(tmp, JSON.stringify({ version: FILE_VERSION, records }), { mode: 0o600 })
      renameSync(tmp, this.filePath)
    } catch {
      try { unlinkSync(tmp) } catch { /* ignore */ }
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.flush()
    }, this.saveDelayMs)
    if (typeof this.saveTimer === 'object' && 'unref' in this.saveTimer) this.saveTimer.unref()
  }
}
