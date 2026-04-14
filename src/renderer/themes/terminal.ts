import type { ITheme } from '@xterm/xterm'

/** Read a CSS variable from :root, with fallback */
function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

/** Build an xterm.js ITheme from the current CSS custom properties */
export function getTerminalTheme(): ITheme {
  const bg = cssVar('--bg-primary', '#0d1117')
  const fg = cssVar('--text-primary', '#e6edf3')
  const accent = cssVar('--accent', '#58a6ff')
  const red = cssVar('--red', '#f85149')
  const green = cssVar('--green', '#3fb950')
  const amber = cssVar('--amber', '#d29922')

  return {
    background: bg,
    foreground: fg,
    cursor: accent,
    selectionBackground: cssVar('--accent-tint-30', accent + '4d'),
    black: bg,
    red,
    green,
    yellow: amber,
    blue: accent,
    magenta: '#bc8cff',
    cyan: '#76e3ea',
    white: fg
  }
}
