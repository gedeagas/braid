type SpinnerSize = 'sm' | 'md' | 'lg'

interface SpinnerProps {
  size?: SpinnerSize
  className?: string
}

const sizeClass: Record<SpinnerSize, string> = {
  sm: 'spinner spinner--sm',
  md: 'spinner spinner--md',
  lg: 'spinner spinner--lg'
}

export function Spinner({ size = 'md', className }: SpinnerProps) {
  const classes = [sizeClass[size], className].filter(Boolean).join(' ')
  return <span className={classes} role="status" aria-label="Loading" />
}
