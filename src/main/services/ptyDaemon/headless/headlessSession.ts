// A session's screen state, kept in the daemon by a headless xterm that is fed
// every byte of PTY output. Lets main stop sending output for terminals the
// user can't see: when one is shown again, the renderer gets a snapshot.
//
// It also:
//  - answers terminal queries (DA1, DSR/CPR, and OSC 10/11/12 with the
//    renderer's colours) in the live output no renderer answers (the
//    `answers` hook, by seq), and never for seeded or replayed output;
//  - runs agent status detection (see statusDetectors);
//  - reports a parse backlog so the PTY can be paused when it falls behind.
//
// Cell widths match the renderer (Unicode 11), or snapshot rows with emoji
// and agent symbols would shift.

import { Terminal } from '@xterm/headless'
import { SerializeAddon } from '@xterm/addon-serialize'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { EscapeTail } from './escapeTail'
import { ModeTracker, type TrackedModes } from './modeTracker'
import { registerDaemonDetectors, type DetectorContext } from './statusDetectors'
import { installColorQueryResponder } from './colorQueries'
import { collectLinkRanges, cursorRestoreSequence } from './snapshotParts'
import type { HeadlessSnapshot, TerminalColors } from '../protocol'

/** Pause the PTY when this many characters are waiting to be parsed. */
const BACKLOG_HIGH = 1024 * 1024
const BACKLOG_LOW = 128 * 1024
/** A snapshot waits this long for an open synchronized-output frame to finish. */
export const SYNC_FRAME_WAIT_MS = 150
const SYNC_FRAME_POLL_MS = 10

export interface HeadlessOptions {
  cols: number
  rows: number
  scrollback: number
}

export interface HeadlessHooks {
  /** A reply to a terminal query, to write to the PTY. */
  reply?: (data: string) => void
  status?: DetectorContext['emit']
  expectedAgentType?: () => string | undefined
  /** true: too much output waiting to be parsed (pause the PTY); false: caught up. */
  backlog?: (behind: boolean) => void
  /** The renderer's terminal colours, for OSC 10/11/12 replies. */
  colors?: () => TerminalColors | null
  /** Whether to answer the queries in the live write numbered `seq` (default: all). */
  answers?: (seq: number | undefined) => boolean
}

interface PendingWrite {
  live: boolean
  chars: number
  seq?: number
}

export class HeadlessSession {
  private term: Terminal
  private serializer = new SerializeAddon()
  private tracker: ModeTracker
  private tail = new EscapeTail()
  private title = ''
  /** One entry per write not yet parsed, in order: xterm parses writes in order. */
  private pending: PendingWrite[] = []
  /** seq of the last parsed live write: what the screen state covers. */
  private parsedSeq = 0
  private backlogChars = 0
  private behind = false
  private disposed = false
  private disposeDetectors: () => void

  constructor(opts: HeadlessOptions, private hooks: HeadlessHooks = {}) {
    this.term = new Terminal({
      cols: opts.cols,
      rows: opts.rows,
      scrollback: opts.scrollback,
      allowProposedApi: true,
    })
    this.term.loadAddon(this.serializer)
    this.term.loadAddon(new Unicode11Addon())
    this.term.unicode.activeVersion = '11'
    this.tracker = new ModeTracker(this.term)
    this.term.onTitleChange((t) => { this.title = t })
    // Replies are generated while xterm parses a write; the head of `pending`
    // is the write being parsed, and its seq decides who answers.
    const reply = (data: string): void => {
      const head = this.pending[0]
      if (head?.live && (this.hooks.answers?.(head.seq) ?? true)) this.hooks.reply?.(data)
    }
    this.term.onData(reply)
    installColorQueryResponder(this.term, () => this.hooks.colors?.() ?? null, reply)
    this.disposeDetectors = registerDaemonDetectors(this.term, {
      expectedAgentType: () => this.hooks.expectedAgentType?.(),
      isLive: () => this.pending[0]?.live ?? true,
      emit: (event) => this.hooks.status?.(event),
    })
  }

  /** seq of the last parsed live write. */
  get parsed(): number {
    return this.parsedSeq
  }

  /** Feed output. `live: false` for checkpoint seeding / replayed history. */
  write(data: string, opts: { live: boolean; seq?: number }): void {
    if (!data || this.disposed) return
    const entry: PendingWrite = { live: opts.live, chars: data.length, seq: opts.seq }
    this.pending.push(entry)
    this.tail.push(data)
    this.backlogChars += data.length
    if (!this.behind && this.backlogChars > BACKLOG_HIGH) {
      this.behind = true
      this.hooks.backlog?.(true)
    }
    this.term.write(data, () => {
      this.pending.shift()
      if (entry.seq !== undefined) this.parsedSeq = entry.seq
      this.backlogChars -= entry.chars
      if (this.behind && this.backlogChars < BACKLOG_LOW) {
        this.behind = false
        this.hooks.backlog?.(false)
      }
    })
  }

  resize(cols: number, rows: number): void {
    if (cols < 1 || rows < 1 || (cols === this.term.cols && rows === this.term.rows)) return
    this.term.resize(cols, rows)
  }

  setScrollback(lines: number): void {
    this.term.options.scrollback = lines
  }

  modes(): TrackedModes {
    return this.tracker.state()
  }

  /**
   * Screen snapshot of all output parsed so far: serialized buffers, modes,
   * cursor, title, then any unfinished escape sequence. `seq` is the last
   * output it covers. Taken at a frame boundary: if a DEC 2026 frame is open,
   * wait (up to SYNC_FRAME_WAIT_MS) for it to close, so the renderer never
   * paints half a redraw. `onCapture` runs at the exact parse point the
   * snapshot covers (before any later output is parsed).
   */
  snapshot(onCapture?: () => void): Promise<HeadlessSnapshot> {
    const start = Date.now()
    return new Promise((resolve) => {
      const attempt = (): void => {
        // Runs right after every earlier write is parsed, before any later one:
        // the state matches parsedSeq exactly.
        this.term.write('', () => {
          if (this.term.modes.synchronizedOutputMode && Date.now() - start < SYNC_FRAME_WAIT_MS && !this.disposed) {
            setTimeout(attempt, SYNC_FRAME_POLL_MS)
            return
          }
          const snap = this.build()
          onCapture?.()
          resolve(snap)
        })
      }
      attempt()
    })
  }

  dispose(): void {
    this.disposed = true
    this.disposeDetectors()
    this.term.dispose()
  }

  private build(): HeadlessSnapshot {
    let data = this.serializer.serialize({ excludeModes: true })
    data += this.tracker.restoreSequence()
    data += cursorRestoreSequence(this.term)
    if (this.title) data += `\x1b]0;${this.title}\x07`
    data += this.tail.value
    const links = collectLinkRanges(this.term)
    return {
      data, cols: this.term.cols, rows: this.term.rows, seq: this.parsedSeq, title: this.title,
      ...(links.length > 0 ? { links } : {}),
    }
  }
}
