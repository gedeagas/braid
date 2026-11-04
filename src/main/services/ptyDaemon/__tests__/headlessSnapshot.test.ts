import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { Terminal } from '@xterm/headless'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { HeadlessSession, SYNC_FRAME_WAIT_MS } from '../headless/headlessSession'
import { unfinishedEscapeStart, EscapeTail } from '../headless/escapeTail'
import { toXColor } from '../headless/colorQueries'

// Real screen captures recorded through a PTY at 100x30 (see fixtures/):
// vim editing a file, less paging and searching, and Claude Code's start
// screen. Personal details were scrubbed from the Claude Code capture.
interface Capture { cols: number; rows: number; chunks: string[] }
const load = (name: string): Capture => JSON.parse(readFileSync(join(__dirname, 'fixtures', `${name}.json`), 'utf8'))

const write = (term: Terminal, data: string) => new Promise<void>((r) => term.write(data, r))

/** Configured like the renderer's xterm (createTerminal): Unicode 11 widths. */
function fresh(cols: number, rows: number): Terminal {
  const term = new Terminal({ cols, rows, scrollback: 1000, allowProposedApi: true })
  term.loadAddon(new Unicode11Addon())
  term.unicode.activeVersion = '11'
  return term
}

/** Everything visible about a terminal that a user (or a program) depends on. */
function screen(term: Terminal) {
  const buf = term.buffer.active
  const lines: string[] = []
  for (let y = 0; y < term.rows; y++) lines.push(buf.getLine(buf.baseY + y)?.translateToString(true) ?? '')
  return {
    type: buf.type,
    cursor: [buf.cursorX, buf.cursorY],
    lines,
    bracketedPaste: term.modes.bracketedPasteMode,
    mouse: term.modes.mouseTrackingMode,
    appKeypad: term.modes.applicationKeypadMode,
    appCursor: term.modes.applicationCursorKeysMode,
    focus: term.modes.sendFocusMode,
  }
}

async function snapshotAt(cap: Capture, prefix: string) {
  const session = new HeadlessSession({ cols: cap.cols, rows: cap.rows, scrollback: 1000 })
  session.write(prefix, { live: true, seq: 42 })
  const snap = await session.snapshot()
  session.dispose()
  return snap
}

async function roundTrip(cap: Capture, cut: number) {
  const stream = cap.chunks.join('')
  const prefix = stream.slice(0, cut)
  const rest = stream.slice(cut)
  const snap = await snapshotAt(cap, prefix)
  expect(snap.seq).toBe(42)
  expect([snap.cols, snap.rows]).toEqual([cap.cols, cap.rows])

  const restored = fresh(cap.cols, cap.rows)
  await write(restored, snap.data)
  const reference = fresh(cap.cols, cap.rows)
  await write(reference, prefix)
  // Same screen at the cut, unless the cut is inside an escape sequence (that
  // part is only applied once the rest of the sequence arrives).
  if (unfinishedEscapeStart(prefix) === -1) expect(screen(restored)).toEqual(screen(reference))

  await write(restored, rest)
  await write(reference, rest)
  expect(screen(restored)).toEqual(screen(reference))
}

describe.each(['vim', 'less', 'claude'])('headless snapshot round trip: %s', (name) => {
  const cap = load(name)
  const stream = cap.chunks.join('')

  it.each([0.2, 0.4, 0.6, 0.8, 1])('restores the screen at %s of the session and keeps up afterwards', async (fraction) => {
    // Cut at a chunk boundary, as the daemon sees it.
    let cut = 0
    for (const chunk of cap.chunks) {
      if (cut + chunk.length > stream.length * fraction) break
      cut += chunk.length
    }
    await roundTrip(cap, cut)
  })

  it('restores correctly when the snapshot is taken in the middle of an escape sequence', async () => {
    const esc = stream.indexOf('\x1b[', Math.floor(stream.length / 2))
    expect(esc).toBeGreaterThan(0)
    await roundTrip(cap, esc + 3)
  })
})

describe('wide characters', () => {
  it('lays out emoji and agent symbols like the renderer (Unicode 11)', async () => {
    // Cut right after the symbols, mid-line: the cursor column depends on their widths.
    const cap = { cols: 20, rows: 4, chunks: ['⏺ done ✳ 😀', ' ok\r\n中文 width\r\n', '😀😀😀😀😀😀😀😀😀😀😀😀'] }
    await roundTrip(cap, cap.chunks[0].length)
  })
})

describe('snapshot terminal modes', () => {
  it('re-applies mouse encoding, bracketed paste, keyboard flags, cursor visibility and the saved cursor', async () => {
    const session = new HeadlessSession({ cols: 40, rows: 10, scrollback: 100 })
    session.write('\x1b[3;7H\x1b7' + '\x1b[?1000h\x1b[?1006h\x1b[?2004h\x1b[>5u\x1b[?25l' + '\x1b[6;2Hhi', { live: true })
    const snap = await session.snapshot()
    session.dispose()

    expect(snap.data).toContain('\x1b[?1006h')
    expect(snap.data).toContain('\x1b[?2004h')
    expect(snap.data).toContain('\x1b[>5u')
    expect(snap.data).toContain('\x1b[?25l')

    const restored = new HeadlessSession({ cols: 40, rows: 10, scrollback: 100 })
    restored.write(snap.data, { live: false })
    const again = await restored.snapshot()
    expect(restored.modes()).toEqual({ mouseEncoding: 1006, kittyFlags: [5], cursorHidden: true, savedCursor: { x: 6, y: 2 } })
    // Cursor after "hi" on row 6, col 4 (1-based) and DECRC returns to 3;7.
    restored.write('\x1b8X', { live: false })
    const restoredAgain = await restored.snapshot()
    expect(again.data).toContain('\x1b[6;4H')
    expect(restoredAgain.data).toContain('X')
    restored.dispose()
  })

  it('tracks kitty keyboard pop and set', async () => {
    const s = new HeadlessSession({ cols: 20, rows: 5, scrollback: 10 })
    s.write('\x1b[>1u\x1b[>3u\x1b[<1u\x1b[=4;2u', { live: true })
    await s.snapshot()
    expect(s.modes().kittyFlags).toEqual([5])
    s.dispose()
  })

  it('includes the last title and sends an unfinished escape last', async () => {
    const s = new HeadlessSession({ cols: 20, rows: 5, scrollback: 10 })
    s.write('\x1b]0;✳ Claude Code\x07hello\x1b[3', { live: true })
    const snap = await s.snapshot()
    expect(snap.title).toBe('✳ Claude Code')
    expect(snap.data.endsWith('\x1b[3')).toBe(true)
    s.dispose()
  })
})

describe('escape tail', () => {
  it.each([
    ['plain', -1],
    ['a\x1b', 1],
    ['a\x1b[', 1],
    ['a\x1b[1;3', 1],
    ['a\x1b[1;3m', -1],
    ['a\x1b]0;title', 1],
    ['a\x1b]0;title\x07', -1],
    ['a\x1b]0;title\x1b\\', -1],
    ['a\x1b]0;title\x1b', 1],
    ['a\x1bP1$r', 1],
    ['a\x1b(', 1],
    ['a\x1b(B', -1],
    ['a\x1b7', -1],
  ])('%j -> %s', (text, expected) => {
    expect(unfinishedEscapeStart(text)).toBe(expected)
  })

  it('carries an unfinished sequence across chunks', () => {
    const tail = new EscapeTail()
    tail.push('abc\x1b]0;ti')
    expect(tail.value).toBe('\x1b]0;ti')
    tail.push('tle')
    expect(tail.value).toBe('\x1b]0;title')
    tail.push('\x07done')
    expect(tail.value).toBe('')
  })
})

describe('headless terminal queries', () => {
  it('answers live queries while answering is on', async () => {
    const replies: string[] = []
    const s = new HeadlessSession({ cols: 20, rows: 5, scrollback: 10 }, { reply: (d) => replies.push(d) })
    s.write('\x1b[c\x1b[6n', { live: true })
    await s.snapshot()
    expect(replies.join('')).toMatch(/\x1b\[\?\d+(;\d+)*c/)
    expect(replies.join('')).toContain('R')
    s.dispose()
  })

  it('does not answer while the renderer shows the terminal', async () => {
    const replies: string[] = []
    let answering = false
    const s = new HeadlessSession({ cols: 20, rows: 5, scrollback: 10 }, { reply: (d) => replies.push(d), answers: () => answering })
    s.write('\x1b[c', { live: true })
    await s.snapshot()
    expect(replies).toEqual([])
    answering = true
    s.write('\x1b[c', { live: true })
    await s.snapshot()
    expect(replies).toHaveLength(1)
    s.dispose()
  })

  it('never answers queries from seeded (checkpoint) or replayed output', async () => {
    const replies: string[] = []
    const s = new HeadlessSession({ cols: 20, rows: 5, scrollback: 10 }, { reply: (d) => replies.push(d) })
    s.write('old \x1b[c\x1b[6n output', { live: false })
    s.write('\x1b]11;?\x07', { live: false })
    await s.snapshot()
    expect(replies).toEqual([])
    s.dispose()
  })

  it('decides per write, even when writes are parsed together later', async () => {
    const replies: string[] = []
    const s = new HeadlessSession({ cols: 20, rows: 5, scrollback: 10 }, { reply: (d) => replies.push(d) })
    s.write('\x1b[c', { live: false })
    s.write('\x1b[c', { live: true })
    s.write('\x1b[c', { live: false })
    await s.snapshot()
    expect(replies).toHaveLength(1)
    s.dispose()
  })
})

describe('snapshot edge cases', () => {
  it('keeps a wrap-pending cursor: the next character wraps instead of overwriting the last column', async () => {
    const cap = { cols: 10, rows: 3, chunks: ['0123456789', 'X'] }
    await roundTrip(cap, cap.chunks[0].length)
  })

  it('restores the saved cursor (DECRC) and scroll region', async () => {
    const cap = { cols: 20, rows: 6, chunks: ['\x1b[2;5r\x1b[3;7Hsaved\x1b7\x1b[5;1Hbottom', '\x1b8HERE\x1b[5;1H\n\nscrolled'] }
    await roundTrip(cap, cap.chunks[0].length)
  })

  it('keeps OSC 8 hyperlinks, which serialize() drops', async () => {
    const s = new HeadlessSession({ cols: 30, rows: 3, scrollback: 10 })
    s.write('see \x1b]8;;https://example.com/a\x07docs\x1b]8;;\x07 here\r\nplain', { live: true, seq: 1 })
    const snap = await s.snapshot()
    expect(snap.links).toEqual([{ row: 0, startCol: 4, endCol: 8, uri: 'https://example.com/a' }])
    s.dispose()
  })

  it('waits for an open synchronized frame to close and reports the seq it covers', async () => {
    const s = new HeadlessSession({ cols: 20, rows: 3, scrollback: 10 })
    s.write('\x1b[?2026h\x1b[2Jhalf', { live: true, seq: 1 })
    const pending = s.snapshot()
    await new Promise((r) => setTimeout(r, 20))
    s.write(' done\x1b[?2026l', { live: true, seq: 2 })
    const snap = await pending
    expect(snap.seq).toBe(2)
    expect(snap.data).toContain('half done')
    s.dispose()
  })

  it('gives up waiting on a frame that never closes', async () => {
    const s = new HeadlessSession({ cols: 20, rows: 3, scrollback: 10 })
    s.write('\x1b[?2026hstuck', { live: true, seq: 5 })
    const t0 = Date.now()
    const snap = await s.snapshot()
    expect(Date.now() - t0).toBeGreaterThanOrEqual(SYNC_FRAME_WAIT_MS - 20)
    expect(snap.seq).toBe(5)
    s.dispose()
  })
})

describe('colour queries (OSC 10/11/12)', () => {
  const colors = { foreground: '#c9d1d9', background: '#0d1117', cursor: '#fff' }

  it('answers with the renderer colours while hidden', async () => {
    const replies: string[] = []
    const s = new HeadlessSession({ cols: 20, rows: 3, scrollback: 10 }, { reply: (d) => replies.push(d), colors: () => colors })
    s.write('\x1b]11;?\x07\x1b]10;?\x1b\\\x1b]12;?\x07', { live: true })
    await s.snapshot()
    expect(replies).toEqual([
      '\x1b]11;rgb:0d0d/1111/1717\x1b\\',
      '\x1b]10;rgb:c9c9/d1d1/d9d9\x1b\\',
      '\x1b]12;rgb:ffff/ffff/ffff\x1b\\',
    ])
    s.dispose()
  })

  it('never answers while the renderer shows the terminal, for seeded output, or without colours', async () => {
    const replies: string[] = []
    const s = new HeadlessSession({ cols: 20, rows: 3, scrollback: 10 }, { reply: (d) => replies.push(d), colors: () => colors, answers: () => false })
    s.write('\x1b]11;?\x07', { live: false })
    s.write('\x1b]11;?\x07', { live: true })
    await s.snapshot()
    const none = new HeadlessSession({ cols: 20, rows: 3, scrollback: 10 }, { reply: (d) => replies.push(d) })
    none.write('\x1b]11;?\x07', { live: true })
    await none.snapshot()
    expect(replies).toEqual([])
    s.dispose()
    none.dispose()
  })
})

describe('toXColor', () => {
  it.each([
    ['#0d1117', 'rgb:0d0d/1111/1717'],
    ['#FFF', 'rgb:ffff/ffff/ffff'],
    ['#0d1117cc', 'rgb:0d0d/1111/1717'],
    ['rgb(13, 17, 23)', 'rgb:0d0d/1111/1717'],
    ['rgba(255,0,0,0.5)', 'rgb:ffff/0000/0000'],
    ['transparent', null],
    [undefined, null],
  ])('%s -> %s', (input, expected) => {
    expect(toXColor(input)).toBe(expected)
  })
})
