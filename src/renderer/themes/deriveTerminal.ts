import type { TerminalColors, ThemePalette } from './palettes'

/** Parse a hex color into [r, g, b] */
function parseHex(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16)
  ]
}

/** Convert [r, g, b] back to hex */
function toHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.min(255, Math.max(0, Math.round(v)))
  return (
    '#' +
    clamp(r).toString(16).padStart(2, '0') +
    clamp(g).toString(16).padStart(2, '0') +
    clamp(b).toString(16).padStart(2, '0')
  )
}

/** Lighten a hex color by a factor (0-1) */
function lighten(hex: string, amount: number): string {
  const [r, g, b] = parseHex(hex)
  return toHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount)
}

/** Darken a hex color by a factor (0-1) */
function darken(hex: string, amount: number): string {
  const [r, g, b] = parseHex(hex)
  return toHex(r * (1 - amount), g * (1 - amount), b * (1 - amount))
}

/**
 * Derive terminal ANSI colors from a theme palette.
 * Used as a fallback for custom/VSCode themes that don't provide explicit terminal colors.
 */
export function deriveTerminalColors(palette: ThemePalette): TerminalColors {
  const c = palette.colors
  const isDark = palette.type === 'dark'
  const brighten = isDark ? lighten : darken

  return {
    black: isDark ? c.bgPrimary : '#2e3440',
    red: c.red,
    green: c.green,
    yellow: c.amber,
    blue: c.accent,
    magenta: c.hlTitle,
    cyan: c.hlMeta,
    white: isDark ? c.textPrimary : '#d8dee9',
    brightBlack: isDark ? c.textMuted : '#4c566a',
    brightRed: brighten(c.red, 0.15),
    brightGreen: brighten(c.green, 0.15),
    brightYellow: brighten(c.amber, 0.15),
    brightBlue: brighten(c.accent, 0.15),
    brightMagenta: brighten(c.hlTitle, 0.15),
    brightCyan: brighten(c.hlMeta, 0.15),
    brightWhite: isDark ? lighten(c.textPrimary, 0.1) : '#eceff4'
  }
}
