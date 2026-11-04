// Per-session glue between a PTY and its headless terminal: numbers output
// (seq), decides who answers terminal queries, tracks the last agent status,
// and combines the two reasons a PTY gets paused (a client's flow control and
// the headless terminal's own parse backlog).

import { HeadlessSession } from './headlessSession'
import { AnswerRule, type Period } from './answerRule'
import type { AgentStatusEvent, HeadlessSnapshot, TerminalColors, WireAgentStatus } from '../protocol'

export interface ScreenPty {
  write(data: string): void
  pause(): void
  resume(): void
}

/** A snapshot announced with setVisible that never comes stops holding answering after this. */
export const HANDOFF_TIMEOUT_MS = 5_000

export interface VisibleOptions {
  /** Shown: a snapshot request follows (the renderer's screen is out of date). */
  snapshotFollows?: boolean
  /** Hidden: the last seq main delivered to the renderer. */
  deliveredThrough?: number
}

export interface ScreenHooks {
  status(event: Omit<AgentStatusEvent, 'type' | 'sessionId'>): void
  expectedAgentType(): string | undefined
  /** The renderer's terminal colours (OSC 10/11/12 replies). */
  colors?(): TerminalColors | null
}

export class SessionScreen {
  /** Sequence number of the last output chunk. */
  seq = 0
  lastStatus?: WireAgentStatus & { source: 'hook' | 'title' | 'terminal_scan' }
  private headless: HeadlessSession
  /** Clients that deliver this session's output to a renderer right now. */
  private visibleBy = new Set<unknown>()
  /** Who answers each live chunk's queries (see AnswerRule). */
  private rule = new AnswerRule()
  /** Snapshots announced by setVisible, per client, not requested yet. */
  private announced = new Map<unknown, { period: Period; timer: ReturnType<typeof setTimeout> }>()
  private clientPaused = false
  private backlogPaused = false
  private ptyPaused = false

  constructor(private pty: ScreenPty, opts: { cols: number; rows: number; scrollback: number }, hooks: ScreenHooks) {
    this.headless = new HeadlessSession(opts, {
      reply: (data) => { try { this.pty.write(data) } catch { /* PTY gone */ } },
      expectedAgentType: hooks.expectedAgentType,
      colors: () => hooks.colors?.() ?? null,
      backlog: (behind) => { this.backlogPaused = behind; this.applyPause() },
      answers: (seq) => seq === undefined || this.rule.daemonAnswers(seq),
      status: (event) => {
        this.lastStatus = { ...event.status, source: event.kind === 'title' ? 'title' : event.kind === 'scan' ? 'terminal_scan' : 'hook' }
        hooks.status(event)
      },
    })
  }

  /** Live PTY output. Returns its sequence number. */
  output(data: string): number {
    this.seq++
    this.headless.write(data, { live: true, seq: this.seq })
    return this.seq
  }

  /** History from a checkpoint (cold restore): never answers queries or announces status. */
  seed(data: string): void {
    this.headless.write(data, { live: false })
  }

  resize(cols: number, rows: number): void {
    this.headless.resize(cols, rows)
  }

  setScrollback(lines: number): void {
    this.headless.setScrollback(lines)
  }

  /**
   * Whether `owner` delivers this session's output to a renderer. Returns the
   * show point: this terminal answers live output numbered up to it (main
   * delivers that output marked no-reply), the renderer what follows.
   */
  setVisible(owner: unknown, visible: boolean, opts: VisibleOptions = {}): number {
    this.rule.prune(this.headless.parsed)
    if (visible) {
      this.dropAnnounced(owner)
      this.visibleBy.add(owner)
      const from = this.rule.show(this.seq)
      if (opts.snapshotFollows) this.announce(owner)
      return from
    }
    this.visibleBy.delete(owner)
    // Before the announced snapshot is dropped: mid-handoff the period goes back whole.
    if (this.visibleBy.size === 0) this.rule.hide(opts.deliveredThrough)
    this.dropAnnounced(owner)
    return this.seq
  }

  /** A client went away: it no longer shows this session. */
  releaseOwner(owner: unknown): void {
    if (this.visibleBy.has(owner) || this.announced.has(owner)) this.setVisible(owner, false)
  }

  /**
   * Screen snapshot. When `owner` shows the session, it is about to replace
   * its screen with this snapshot, so its renderer never parses the output the
   * snapshot covers: this terminal answers the queries in that output (also
   * those parsed while the snapshot waits for a frame to end, or since a
   * setVisible that announced it), and the renderer answers everything after.
   */
  snapshot(owner?: unknown): Promise<HeadlessSnapshot> {
    if (owner === undefined || !this.visibleBy.has(owner)) return this.headless.snapshot()
    const pending = this.announced.get(owner)
    if (pending) clearTimeout(pending.timer)
    this.announced.delete(owner)
    const period = pending?.period ?? this.rule.beginHandoff()
    return this.headless.snapshot(() => {
      if (period) this.rule.endHandoff(period, this.headless.parsed)
    })
  }

  /** Flow-control pause from clients (through the PauseValve). */
  setClientPaused(paused: boolean): void {
    this.clientPaused = paused
    this.applyPause()
  }

  dispose(): void {
    for (const { timer } of this.announced.values()) clearTimeout(timer)
    this.announced.clear()
    this.headless.dispose()
  }

  /** Keep answering this period until the announced snapshot is taken (or never comes). */
  private announce(owner: unknown): void {
    const period = this.rule.beginHandoff()
    if (!period) return
    const timer = setTimeout(() => {
      this.announced.delete(owner)
      this.rule.endHandoff(period, this.headless.parsed)
    }, HANDOFF_TIMEOUT_MS)
    timer.unref?.()
    this.announced.set(owner, { period, timer })
  }

  private dropAnnounced(owner: unknown): void {
    const pending = this.announced.get(owner)
    if (!pending) return
    clearTimeout(pending.timer)
    this.announced.delete(owner)
    this.rule.endHandoff(pending.period, this.headless.parsed)
  }

  private applyPause(): void {
    const want = this.clientPaused || this.backlogPaused
    if (want === this.ptyPaused) return
    this.ptyPaused = want
    try {
      if (want) this.pty.pause()
      else this.pty.resume()
    } catch { /* PTY gone */ }
  }
}
