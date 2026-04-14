interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  hint?: string
  action?: React.ReactNode
}

export function EmptyState({ icon, title, hint, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-state-icon">{icon}</div>}
      <p className="empty-state-text">{title}</p>
      {hint && <p className="empty-state-hint">{hint}</p>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  )
}
