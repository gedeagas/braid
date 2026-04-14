import { useId, isValidElement, cloneElement, Children } from 'react'

interface FormFieldProps {
  label: string
  hint?: string
  /**
   * Horizontal layout: label on the left, control on the right.
   * When a hint is provided in horizontal mode, label + hint are wrapped
   * in a <div> so the control stays right-aligned.
   */
  horizontal?: boolean
  children: React.ReactNode
  className?: string
}

export function FormField({ label, hint, horizontal, children, className }: FormFieldProps) {
  const fieldId = useId()
  const classes = [
    'settings-field',
    horizontal && 'settings-field--row',
    className
  ]
    .filter(Boolean)
    .join(' ')

  // In horizontal mode with a hint, wrap label+hint so flexbox
  // keeps the control right-aligned.
  const labelContent = (
    <>
      <label className="settings-label" htmlFor={fieldId}>{label}</label>
      {hint && <span className="settings-hint">{hint}</span>}
    </>
  )

  // Inject id={fieldId} into the first React element child so the
  // <label htmlFor> actually connects to the interactive control.
  const childArray = Children.toArray(children)
  const enhanced = childArray.map((child, i) => {
    if (i === 0 && isValidElement(child)) {
      return cloneElement(child as React.ReactElement<{ id?: string }>, { id: fieldId })
    }
    return child
  })

  return (
    <div className={classes}>
      {horizontal && hint ? <div>{labelContent}</div> : labelContent}
      {enhanced}
    </div>
  )
}
