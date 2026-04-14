import type { ThemePalette } from './palettes'

/** Convert hex color + opacity (0-100) to hex with alpha channel */
export function hexAlpha(hex: string, opacity: number): string {
  const alpha = Math.round((opacity / 100) * 255)
    .toString(16)
    .padStart(2, '0')
  return hex + alpha
}

/** Linearly interpolate two hex colors: t=0 → a, t=1 → b */
function blendHex(a: string, b: string, t: number): string {
  const parse = (h: string) => [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16)
  ]
  const [r1, g1, b1] = parse(a)
  const [r2, g2, b2] = parse(b)
  const mix = (c1: number, c2: number) =>
    Math.round(c1 + (c2 - c1) * t).toString(16).padStart(2, '0')
  return `#${mix(r1, r2)}${mix(g1, g2)}${mix(b1, b2)}`
}

/** Set a batch of CSS custom properties on :root */
function setVars(vars: Record<string, string>): void {
  const style = document.documentElement.style
  for (const [key, value] of Object.entries(vars)) {
    style.setProperty(key, value)
  }
}

export function applyTheme(palette: ThemePalette): void {
  const c = palette.colors

  // Base variables
  setVars({
    '--bg-primary': c.bgPrimary,
    '--bg-secondary': c.bgSecondary,
    '--bg-tertiary': c.bgTertiary,
    '--bg-hover': c.bgHover,
    '--border': c.border,
    '--text-primary': c.textPrimary,
    '--text-secondary': c.textSecondary,
    '--text-muted': c.textMuted,
    '--text-tertiary': blendHex(c.textMuted, c.bgPrimary, 0.35),
    '--accent': c.accent,
    '--accent-hover': c.accentHover,
    '--green': c.green,
    '--red': c.red,
    '--amber': c.amber,
    '--olive': c.olive
  })

  // Accent tints
  setVars({
    '--accent-tint-4': hexAlpha(c.accent, 4),
    '--accent-tint-6': hexAlpha(c.accent, 6),
    '--accent-tint-8': hexAlpha(c.accent, 8),
    '--accent-tint-10': hexAlpha(c.accent, 10),
    '--accent-tint-15': hexAlpha(c.accent, 15),
    '--accent-tint-18': hexAlpha(c.accent, 18),
    '--accent-tint-22': hexAlpha(c.accent, 22),
    '--accent-tint-30': hexAlpha(c.accent, 30),
    '--accent-tint-40': hexAlpha(c.accent, 40),
    '--accent-tint-65': hexAlpha(c.accent, 65)
  })

  // Red tints
  setVars({
    '--red-tint-8': hexAlpha(c.red, 8),
    '--red-tint-10': hexAlpha(c.red, 10),
    '--red-tint-12': hexAlpha(c.red, 12),
    '--red-tint-15': hexAlpha(c.red, 15),
    '--red-tint-18': hexAlpha(c.red, 18),
    '--red-tint-20': hexAlpha(c.red, 20),
    '--red-tint-30': hexAlpha(c.red, 30),
    '--red-tint-35': hexAlpha(c.red, 35)
  })

  // Green tints
  setVars({
    '--green-tint-4': hexAlpha(c.green, 4),
    '--green-tint-10': hexAlpha(c.green, 10),
    '--green-tint-15': hexAlpha(c.green, 15),
    '--green-tint-22': hexAlpha(c.green, 22),
    '--green-tint-65': hexAlpha(c.green, 65)
  })

  // Amber tints
  setVars({
    '--amber-tint-6': hexAlpha(c.amber, 6),
    '--amber-tint-10': hexAlpha(c.amber, 10),
    '--amber-tint-14': hexAlpha(c.amber, 14),
    '--amber-tint-15': hexAlpha(c.amber, 15),
    '--amber-tint-18': hexAlpha(c.amber, 18),
    '--amber-tint-22': hexAlpha(c.amber, 22),
    '--amber-glow': hexAlpha(c.amber, 40)
  })

  // Olive tints
  setVars({
    '--olive-tint-20': hexAlpha(c.olive, 20)
  })

  // Purple tint (for merged PR state — always purple regardless of theme)
  setVars({
    '--purple-tint-20': '#8a63d233'
  })

  // Overlay — white for dark themes, black for light themes
  const overlayBase = palette.type === 'dark' ? '#ffffff' : '#000000'
  setVars({
    '--overlay-3': hexAlpha(overlayBase, 3),
    '--overlay-6': hexAlpha(overlayBase, 6),
    '--overlay-8': hexAlpha(overlayBase, 8)
  })

  // Shadows — always black-based
  setVars({
    '--shadow-20': hexAlpha('#000000', 20),
    '--shadow-35': hexAlpha('#000000', 35),
    '--shadow-40': hexAlpha('#000000', 40),
    '--shadow-45': hexAlpha('#000000', 45),
    '--shadow-50': hexAlpha('#000000', 50),
    '--shadow-60': hexAlpha('#000000', 60)
  })

  // Syntax highlighting (highlight.js)
  setVars({
    '--hljs-base': c.hlBase,
    '--hljs-comment': c.hlComment,
    '--hljs-keyword': c.hlKeyword,
    '--hljs-attr-name': c.hlAttrName,
    '--hljs-string': c.hlString,
    '--hljs-title': c.hlTitle,
    '--hljs-type': c.hlType,
    '--hljs-number': c.hlNumber,
    '--hljs-meta': c.hlMeta,
    '--hljs-variable': c.hlVariable,
    '--hljs-tag': c.hlTag,
    '--hljs-attr': c.hlAttr
  })

  // Set data-theme attribute for any CSS-only selectors
  document.documentElement.setAttribute('data-theme', palette.type)
}
