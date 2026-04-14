/**
 * Segmented control for settings with 2–4 mutually exclusive options.
 *
 * Use this instead of radio buttons for short option lists.
 * For 5+ options use a <select className="settings-select">.
 * Styled by .segmented-control / .segmented-control__btn in settings.css.
 *
 * Typical usage:
 *   <div className="settings-field settings-field--row">
 *     <label className="settings-label">Style</label>
 *     <SegmentedControl options={[{value:'a',label:'A'},{value:'b',label:'B'}]} value={v} onChange={setV} />
 *   </div>
 */
interface SegmentedControlProps<T extends string | number> {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
  disabled?: boolean
}

export function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  disabled,
}: SegmentedControlProps<T>) {
  return (
    <div
      className="segmented-control"
      style={{ opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? 'none' : 'auto' }}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          className={`segmented-control__btn${opt.value === value ? ' segmented-control__btn--active' : ''}`}
          onClick={() => onChange(opt.value)}
          disabled={disabled}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
