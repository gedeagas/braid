export const TERMINAL_SCROLLBACK_MIN_LINES = 100
export const TERMINAL_SCROLLBACK_MAX_LINES = 100_000
export const DEFAULT_TERMINAL_SCROLLBACK_LINES = 50_000

const TERMINAL_SCROLLBACK_BUFFER_CHARS_PER_LINE = 200

export function clampTerminalScrollbackLines(lines: number): number {
  if (!Number.isFinite(lines)) return DEFAULT_TERMINAL_SCROLLBACK_LINES
  return Math.max(
    TERMINAL_SCROLLBACK_MIN_LINES,
    Math.min(TERMINAL_SCROLLBACK_MAX_LINES, Math.round(lines)),
  )
}

export function getTerminalScrollbackBufferMaxLength(lines: number): number {
  return clampTerminalScrollbackLines(lines) * TERMINAL_SCROLLBACK_BUFFER_CHARS_PER_LINE
}
