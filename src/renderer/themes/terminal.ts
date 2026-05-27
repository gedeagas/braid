import type { ITheme } from '@xterm/xterm'

export const TERMINAL_LIGHT_MINIMUM_CONTRAST_RATIO = 4.5
export const TERMINAL_DARK_MINIMUM_CONTRAST_RATIO = 1

export function getTerminalMinimumContrastRatio(): number {
  return document.documentElement.getAttribute('data-theme') === 'light'
    ? TERMINAL_LIGHT_MINIMUM_CONTRAST_RATIO
    : TERMINAL_DARK_MINIMUM_CONTRAST_RATIO
}

/** Read a CSS variable from :root, with fallback */
function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

/** Build an xterm.js ITheme from the current CSS custom properties */
export function getTerminalTheme(): ITheme {
  const bg = cssVar('--bg-primary', '#0d1117')
  const fg = cssVar('--text-primary', '#e6edf3')
  const accent = cssVar('--accent', '#58a6ff')

  return {
    background: bg,
    foreground: fg,
    cursor: accent,
    selectionBackground: cssVar('--accent-tint-30', accent + '4d'),
    // Base 8 ANSI colors
    black: cssVar('--term-black', '#0d1117'),
    red: cssVar('--term-red', '#f85149'),
    green: cssVar('--term-green', '#3fb950'),
    yellow: cssVar('--term-yellow', '#d29922'),
    blue: cssVar('--term-blue', '#58a6ff'),
    magenta: cssVar('--term-magenta', '#d2a8ff'),
    cyan: cssVar('--term-cyan', '#79c0ff'),
    white: cssVar('--term-white', '#e6edf3'),
    // Bright 8 ANSI colors
    brightBlack: cssVar('--term-bright-black', '#6e7681'),
    brightRed: cssVar('--term-bright-red', '#ffa198'),
    brightGreen: cssVar('--term-bright-green', '#56d364'),
    brightYellow: cssVar('--term-bright-yellow', '#e3b341'),
    brightBlue: cssVar('--term-bright-blue', '#79c0ff'),
    brightMagenta: cssVar('--term-bright-magenta', '#d2a8ff'),
    brightCyan: cssVar('--term-bright-cyan', '#a5d6ff'),
    brightWhite: cssVar('--term-bright-white', '#f0f6fc')
  }
}
