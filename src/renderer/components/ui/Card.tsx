interface CardProps {
  title?: string
  children: React.ReactNode
  className?: string
}

/**
 * A grouped container with a border, background, and optional title.
 * Uses `.ui-card` as its base class (defined in base.css).
 * The `.settings-card` alias is still available for settings pages that
 * use it directly via className.
 */
export function Card({ title, children, className }: CardProps) {
  const classes = ['ui-card', className].filter(Boolean).join(' ')
  return (
    <div className={classes}>
      {title && <p className="ui-card-title">{title}</p>}
      {children}
    </div>
  )
}
