import { useEffect, useRef } from 'react'

/**
 * Themeable checkbox control.
 *
 * Use for all boolean selections (multi-select lists, confirmations, filters).
 * For on/off settings toggles, use <Toggle> instead.
 *
 * When `label` is provided the outer element is a <label> (full click-target).
 * Without `label` it renders a <span> so it can be nested inside an external
 * <label> without triggering the double-toggle browser bug.
 */

type CheckboxSize = 'sm' | 'md'

interface CheckboxProps {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  indeterminate?: boolean
  size?: CheckboxSize
  label?: string
  className?: string
}

export function Checkbox({
  checked,
  onChange,
  disabled,
  indeterminate,
  size = 'md',
  label,
  className,
}: CheckboxProps) {
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate
  }, [indeterminate])

  const cls = ['checkbox', size === 'sm' && 'checkbox--sm', disabled && 'checkbox--disabled', className]
    .filter(Boolean)
    .join(' ')

  const inner = (
    <>
      <input
        ref={ref}
        type="checkbox"
        className="checkbox__input"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="checkbox__box" aria-hidden="true" />
      {label && <span className="checkbox__label">{label}</span>}
    </>
  )

  return label ? (
    <label className={cls}>{inner}</label>
  ) : (
    <span className={cls}>{inner}</span>
  )
}
