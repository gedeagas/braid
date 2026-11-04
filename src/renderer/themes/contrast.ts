/**
 * WCAG 2.x contrast helpers used by the theme engine to guarantee readable
 * secondary/muted text regardless of which (builtin, custom, or imported)
 * palette is active.
 */

/** WCAG AA minimum for normal-size text. Applies to de-emphasized text too. */
export const MIN_TEXT_CONTRAST = 4.5

const HEX6 = /^#[0-9a-fA-F]{6}$/

type Rgb = [number, number, number]

function parseHex(hex: string): Rgb {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16)
  ]
}

function toHex([r, g, b]: Rgb): string {
  const h = (n: number) => Math.round(n).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function ratio(a: Rgb, b: Rgb): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** WCAG contrast ratio between two `#rrggbb` colors (1..21). */
export function contrastRatio(a: string, b: string): number {
  return ratio(parseHex(a), parseHex(b))
}

/**
 * Return `fg` unchanged if it reaches `target` contrast against every
 * background; otherwise move it along the line toward `anchor` (normally the
 * primary text color) by the smallest amount that passes. Falls back to
 * `anchor` when the target is unreachable. Non-hex inputs pass through.
 */
export function ensureContrast(fg: string, backgrounds: string[], target: number, anchor: string): string {
  if (!HEX6.test(fg) || !HEX6.test(anchor) || !backgrounds.every((b) => HEX6.test(b))) return fg

  const bgs = backgrounds.map(parseHex)
  const passes = (c: Rgb) => bgs.every((bg) => ratio(c, bg) >= target)

  const from = parseHex(fg)
  if (passes(from)) return fg
  const to = parseHex(anchor)
  if (!passes(to)) return anchor

  let lo = 0
  let hi = 1
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2
    if (passes(mix(from, to, mid))) hi = mid
    else lo = mid
  }
  // Rounding to integer channels can land a hair under target; nudge forward.
  let t = hi
  let out = toHex(mix(from, to, t))
  while (!passes(parseHex(out)) && t < 1) {
    t = Math.min(1, t + 0.01)
    out = toHex(mix(from, to, t))
  }
  return out
}
