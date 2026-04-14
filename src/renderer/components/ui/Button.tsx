import { forwardRef } from 'react'
import { Spinner } from './Spinner'

type ButtonVariant = 'default' | 'primary' | 'danger'
type ButtonSize = 'default' | 'sm' | 'icon' | 'icon-sm'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Shows a spinner and disables the button. */
  loading?: boolean
}

const variantClass: Record<ButtonVariant, string> = {
  default: 'btn',
  primary: 'btn btn-primary',
  danger: 'btn btn-danger',
}

const sizeClass: Record<ButtonSize, string> = {
  default: '',
  sm: 'btn--sm',
  icon: 'btn-icon',
  'icon-sm': 'btn-icon-sm'
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'default', size = 'default', loading, className, children, disabled, ...props }, ref) => {
    const isIconSize = size === 'icon' || size === 'icon-sm'
    // Icon-size buttons drop the variant styling (they're always transparent)
    const base = isIconSize ? sizeClass[size] : variantClass[variant]
    const sizeStr = isIconSize ? '' : sizeClass[size]
    const classes = [base, sizeStr, className].filter(Boolean).join(' ')

    return (
      <button ref={ref} className={classes} disabled={disabled || loading} {...props}>
        {loading && <Spinner size="sm" />}
        {children}
      </button>
    )
  }
)

Button.displayName = 'Button'
