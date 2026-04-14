import { useEffect, useCallback, useRef, useId } from 'react'

interface DialogProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  actions?: React.ReactNode
  /** CSS width value e.g. '480px', '50vw'. Defaults to CSS-controlled width. */
  width?: string
  className?: string
}

export function Dialog({ isOpen, onClose, title, children, actions, width, className }: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    },
    [onClose]
  )

  // Focus the dialog panel on open; restore focus to the previously-focused element on close
  useEffect(() => {
    if (!isOpen) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    const frame = requestAnimationFrame(() => {
      dialogRef.current?.focus()
    })
    return () => {
      cancelAnimationFrame(frame)
      previouslyFocused?.focus()
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [isOpen, handleEscape])

  if (!isOpen) return null

  const classes = ['dialog', className].filter(Boolean).join(' ')

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={classes}
        style={width ? { width } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        {title && <h2 id={titleId}>{title}</h2>}
        {children}
        {actions && <div className="dialog-actions">{actions}</div>}
      </div>
    </div>
  )
}
