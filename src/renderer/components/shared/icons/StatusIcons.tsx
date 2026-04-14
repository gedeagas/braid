/**
 * Status & special-behavior SVG icons.
 * These accept dynamic color props or behavioral props (open, className).
 */
import { type IconProps, type ColorIconProps } from './types'

// ─── CI check status icons (16×16) ──────────────────────────────────────────

export const IconCheckCircle = ({ size = 16, color = 'var(--green)', ...p }: ColorIconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, ...p?.style }} className={p?.className}>
    <circle cx="8" cy="8" r="7.5" stroke={color} strokeWidth="1" />
    <path d="M5 8l2 2 4-4" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export const IconXCircleStatus = ({ size = 16, color = 'var(--red)', ...p }: ColorIconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, ...p?.style }} className={p?.className}>
    <circle cx="8" cy="8" r="7.5" stroke={color} strokeWidth="1" />
    <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
  </svg>
)

export const IconSkipCircle = ({ size = 16, color = 'var(--text-muted)', ...p }: ColorIconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, ...p?.style }} className={p?.className}>
    <circle cx="8" cy="8" r="7.5" stroke={color} strokeWidth="1" />
    <path d="M5 8h6" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
  </svg>
)

export const IconSpinner = ({ size = 16, ...p }: IconProps) => (
  <svg
    width={size} height={size} viewBox="0 0 16 16" fill="none"
    style={{ flexShrink: 0, ...p?.style }}
    className={['spin-slow', p?.className].filter(Boolean).join(' ')}
  >
    <circle cx="8" cy="8" r="7" stroke="var(--border)" strokeWidth="1.5" />
    <path d="M8 1a7 7 0 0 1 7 7" stroke="var(--amber)" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
)

export const IconDeployment = ({ size = 14, ...p }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={p?.className} style={p?.style}>
    <circle cx="8" cy="8" r="6.5" stroke="var(--text-muted)" strokeWidth="1" />
    <circle cx="8" cy="8" r="2" fill="var(--text-muted)" />
  </svg>
)

// ─── Git merge graph (16×16) ─────────────────────────────────────────────────

export const IconMergeGraph = ({ size = 14, ...p }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={p?.className} style={p?.style}>
    <circle cx="5" cy="4" r="2" stroke="currentColor" strokeWidth="1.2" />
    <circle cx="5" cy="12" r="2" stroke="currentColor" strokeWidth="1.2" />
    <circle cx="11" cy="8" r="2" stroke="currentColor" strokeWidth="1.2" />
    <path d="M5 6v4M7 4h2a2 2 0 0 1 2 2v0" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
)

export const IconExternalLinkSmall = ({ size = 10, ...p }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" className={p?.className} style={p?.style}>
    <path d="M3.5 1.5h7v7M10.5 1.5l-9 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export const IconChevronDownSmall = ({ size = 10, ...p }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 10 10" fill="none" className={p?.className} style={p?.style}>
    <path d="M2.5 3.5l2.5 3 2.5-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

// ─── Dynamic-color PR branch icon ────────────────────────────────────────────

export const IconPrBranch = ({ size = 14, color = 'currentColor', ...p }: ColorIconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, ...p?.style }} className={p?.className}>
    <circle cx="4" cy="3" r="1.5" stroke={color} strokeWidth="1.5" />
    <circle cx="12" cy="3" r="1.5" stroke={color} strokeWidth="1.5" />
    <circle cx="4" cy="13" r="1.5" stroke={color} strokeWidth="1.5" />
    <line x1="4" y1="4.5" x2="4" y2="11.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    <path d="M12 4.5 C12 7.5, 4 7.5, 4 11.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" fill="none" />
  </svg>
)

// ─── File tree chevron with rotation ─────────────────────────────────────────

interface TreeChevronProps extends IconProps {
  open?: boolean
}

export const IconTreeChevron = ({ size = 12, open = false, ...p }: TreeChevronProps) => (
  <svg
    width={size} height={size} viewBox="0 0 10 10" fill="none"
    style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.12s', flexShrink: 0, ...p?.style }}
    className={p?.className}
  >
    <path d="M3 2L7 5L3 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)
