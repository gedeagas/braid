type BadgeVariant = 'default' | 'accent' | 'success' | 'warning' | 'danger' | 'muted'
type BadgeSize = 'sm' | 'md'

interface BadgeProps {
  variant?: BadgeVariant
  size?: BadgeSize
  children: React.ReactNode
  className?: string
}

export function Badge({ variant = 'default', size = 'md', children, className }: BadgeProps) {
  const classes = ['badge', `badge--${variant}`, `badge--${size}`, className]
    .filter(Boolean)
    .join(' ')
  return <span className={classes}>{children}</span>
}
