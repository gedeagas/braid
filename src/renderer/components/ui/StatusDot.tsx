type StatusDotState = 'success' | 'failure' | 'pending' | 'skipped'

interface StatusDotProps {
  state: StatusDotState
  /** Additional className */
  className?: string
}

/**
 * Small colored circle indicating status.
 * Replaces inline style={{ width: 8, height: 8, borderRadius: '50%', ... }} patterns.
 */
export function StatusDot({ state, className }: StatusDotProps) {
  const classes = ['status-dot', `status-dot--${state}`, className].filter(Boolean).join(' ')
  return <span className={classes} />
}
