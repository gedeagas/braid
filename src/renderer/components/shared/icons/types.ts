import type { CSSProperties } from 'react'

/**
 * Icon size scale. Below 12px glyphs (especially close/chevron strokes) stop
 * being legible at 1x zoom, so `xs` is the floor. Enforced by
 * styles/__tests__/sizingGuards.test.ts.
 */
export const ICON_SIZE = { xs: 12, sm: 14, md: 16, lg: 20 } as const
export const MIN_ICON_SIZE = ICON_SIZE.xs

export interface IconProps {
  size?: number
  className?: string
  style?: CSSProperties
}

export interface ColorIconProps extends IconProps {
  color?: string
}

// ─── Shared SVG attribute helpers ────────────────────────────────────────────

const strokeDefaults = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

/** Returns spread-ready SVG attrs for 24×24 viewBox stroke icons. */
export function strokeIcon(size: number, props?: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    ...strokeDefaults,
    ...(props?.className ? { className: props.className } : {}),
    ...(props?.style ? { style: props.style } : {}),
  }
}

/** Returns spread-ready SVG attrs for 16×16 viewBox fill icons. */
export function fillIcon(size: number, props?: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'currentColor',
    ...(props?.className ? { className: props.className } : {}),
    ...(props?.style ? { style: props.style } : {}),
  }
}
