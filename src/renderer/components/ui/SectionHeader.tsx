import type { ReactNode } from 'react'

interface SectionHeaderProps {
  title: string
  /** Optional badge/count displayed next to the title */
  count?: ReactNode
  /** Action element rendered on the right side */
  action?: ReactNode
  /** Additional className */
  className?: string
}

/**
 * Section header with title on the left and optional action on the right.
 * Used across Checks, Jira, Changes, and other right-panel sections.
 */
export function SectionHeader({ title, count, action, className }: SectionHeaderProps) {
  const classes = ['section-header', className].filter(Boolean).join(' ')
  return (
    <div className={classes}>
      <span className="section-header-title">
        {title}
        {count != null && <span className="section-header-count">{count}</span>}
      </span>
      {action && <div className="section-header-actions">{action}</div>}
    </div>
  )
}
