// OSC 10 / 11 / 12 colour queries (foreground, background, cursor). A headless
// xterm has no theme and does not answer them, but agents (Claude Code, Codex)
// ask for the background to pick a light or dark theme. While the terminal is
// hidden the daemon answers with the colours the renderer pushed (its real
// theme), so the answer is the same one the renderer would give.

import type { Terminal } from '@xterm/headless'
import type { TerminalColors } from '../protocol'

const QUERIES: Array<[number, keyof TerminalColors]> = [[10, 'foreground'], [11, 'background'], [12, 'cursor']]

/** '#rgb' / '#rrggbb' / 'rgb(r, g, b)' -> 'rgb:rrrr/gggg/bbbb' (XParseColor, as xterm replies). Null otherwise. */
export function toXColor(color: string | undefined): string | null {
  const value = color?.trim() ?? ''
  const fn = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i.exec(value)
  if (fn) {
    const parts = fn.slice(1, 4).map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0'))
    return `rgb:${parts.map((p) => p + p).join('/')}`
  }
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(value)
  if (!m) return null
  const hex = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1]
  const parts = [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)].map((p) => (p + p).toLowerCase())
  return `rgb:${parts.join('/')}`
}

export function installColorQueryResponder(
  term: Terminal,
  getColors: () => TerminalColors | null,
  reply: (data: string) => void,
): void {
  for (const [ident, key] of QUERIES) {
    term.parser.registerOscHandler(ident, (data) => {
      // Only queries; setting a colour is left to xterm.
      if (data !== '?') return false
      const value = toXColor(getColors()?.[key])
      if (value) reply(`\x1b]${ident};${value}\x1b\\`)
      return true
    })
  }
}
