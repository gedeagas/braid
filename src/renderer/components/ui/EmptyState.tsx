import type { ReactNode } from 'react'

type EmptyStateVariant = 'default' | 'panel' | 'hero'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  hint?: string
  action?: ReactNode
  variant?: EmptyStateVariant
  className?: string
}

export function EmptyState({ icon, title, hint, action, variant = 'default', className }: EmptyStateProps) {
  const classes = [
    'empty-state',
    variant !== 'default' ? `empty-state--${variant}` : '',
    className,
  ].filter(Boolean).join(' ')

  return (
    <div className={classes}>
      {icon && <div className="empty-state-icon">{icon}</div>}
      <p className="empty-state-text">{title}</p>
      {hint && <p className="empty-state-hint">{hint}</p>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  )
}
