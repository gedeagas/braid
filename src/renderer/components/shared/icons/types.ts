import type { CSSProperties } from 'react'

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
