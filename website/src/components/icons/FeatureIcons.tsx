import React from 'react'

const svgProps: React.SVGProps<SVGSVGElement> = {
  width: 32,
  height: 32,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

/** Git branch / worktree icon */
export function WorktreeIcon() {
  return (
    <svg {...svgProps}>
      <circle cx="6" cy="6" r="2" />
      <circle cx="18" cy="18" r="2" />
      <circle cx="18" cy="8" r="2" />
      <path d="M6 8v2a4 4 0 0 0 4 4h4" />
      <path d="M18 10v6" />
    </svg>
  )
}

/** AI / robot chat icon */
export function AgentIcon() {
  return (
    <svg {...svgProps}>
      <rect x="3" y="8" width="18" height="12" rx="3" />
      <circle cx="9" cy="14" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="15" cy="14" r="1.5" fill="currentColor" stroke="none" />
      <path d="M9 4h6" />
      <path d="M12 4v4" />
    </svg>
  )
}

/** Git merge / branch icon */
export function GitIcon() {
  return (
    <svg {...svgProps}>
      <circle cx="6" cy="6" r="2" />
      <circle cx="6" cy="18" r="2" />
      <circle cx="18" cy="12" r="2" />
      <path d="M6 8v8" />
      <path d="M16 12H9a3 3 0 0 1-3-3" />
    </svg>
  )
}

/** Terminal / code icon */
export function TerminalIcon() {
  return (
    <svg {...svgProps}>
      <rect x="2" y="4" width="20" height="16" rx="3" />
      <path d="M7 9l3 3-3 3" />
      <path d="M13 15h4" />
    </svg>
  )
}

/** Kanban / mission control icon */
export function KanbanIcon() {
  return (
    <svg {...svgProps}>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M8 7v4" />
      <path d="M12 7v8" />
      <path d="M16 7v6" />
    </svg>
  )
}

/** Palette / theme icon */
export function ThemeIcon() {
  return (
    <svg {...svgProps}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="10" cy="9" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="15" cy="10" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="8" cy="13" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="13.5" cy="14.5" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  )
}
