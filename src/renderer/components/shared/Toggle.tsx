/**
 * Apple-style toggle switch for boolean settings.
 *
 * Use this for ALL boolean settings — never use a raw <input type="checkbox">.
 * Styled by .toggle / .toggle-track in settings.css.
 *
 * Typical usage inside a settings row:
 *   <div className="settings-field settings-field--row">
 *     <label className="settings-label">Enable feature</label>
 *     <Toggle checked={value} onChange={setValue} />
 *   </div>
 */
interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}

export function Toggle({ checked, onChange, disabled }: ToggleProps) {
  return (
    <label className="toggle">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="toggle-track" />
    </label>
  )
}
