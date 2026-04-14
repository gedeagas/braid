type DotsSize = 'sm' | 'md' | 'lg'

interface BouncingDotsProps {
  size?: DotsSize
  className?: string
}

const sizeClass: Record<DotsSize, string> = {
  sm: 'bouncing-dots bouncing-dots--sm',
  md: 'bouncing-dots bouncing-dots--md',
  lg: 'bouncing-dots bouncing-dots--lg',
}

export function BouncingDots({ size = 'md', className }: BouncingDotsProps) {
  const classes = [sizeClass[size], className].filter(Boolean).join(' ')
  return (
    <span className={classes} role="status" aria-label="Loading">
      <span className="bouncing-dots__dot" />
      <span className="bouncing-dots__dot" />
      <span className="bouncing-dots__dot" />
    </span>
  )
}
