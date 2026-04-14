import { useReducer, useRef, useEffect, useCallback, useId, type ReactNode } from 'react'

interface ComboboxProps {
  /** Available options (displayed in dropdown) */
  items: string[]
  /** Currently selected item */
  value?: string
  /** Called when user picks an item */
  onSelect: (item: string) => void
  /** Content rendered inside the trigger button */
  children: ReactNode
  /** Called when dropdown opens (e.g. to load items lazily) */
  onOpen?: () => void
  /** Disable the trigger */
  disabled?: boolean
  /** Placeholder for the search/filter input */
  filterPlaceholder?: string
  /** Text shown when no items match the filter */
  emptyText?: string
  /** Custom item renderer — default shows label with accent color for selected */
  renderItem?: (item: string, state: { isSelected: boolean; isHighlighted: boolean }) => ReactNode
  /** CSS class on the wrapper div (e.g. for positioning context) */
  className?: string
  /** CSS class on the trigger button */
  triggerClassName?: string
}

type ComboboxState = { open: boolean; filter: string; highlighted: number }
type ComboboxAction =
  | { type: 'CLOSE' }
  | { type: 'TOGGLE' }
  | { type: 'SET_FILTER'; filter: string }
  | { type: 'SET_HIGHLIGHTED'; index: number }
  | { type: 'HIGHLIGHT_NEXT'; max: number }
  | { type: 'HIGHLIGHT_PREV' }

function comboboxReducer(state: ComboboxState, action: ComboboxAction): ComboboxState {
  switch (action.type) {
    case 'CLOSE': return { ...state, open: false, filter: '' }
    case 'TOGGLE': return state.open ? { ...state, open: false, filter: '' } : { open: true, filter: '', highlighted: 0 }
    case 'SET_FILTER': return { ...state, filter: action.filter, highlighted: 0 }
    case 'SET_HIGHLIGHTED': return { ...state, highlighted: action.index }
    case 'HIGHLIGHT_NEXT': return { ...state, highlighted: Math.min(state.highlighted + 1, action.max) }
    case 'HIGHLIGHT_PREV': return { ...state, highlighted: Math.max(state.highlighted - 1, 0) }
  }
}

/**
 * Searchable dropdown combobox.
 *
 * Manages open/close, filter text, keyboard navigation (↑↓ Enter Escape),
 * outside-click dismiss, auto-focus of filter input, and scroll-to-highlighted.
 *
 * The trigger button gets aria-haspopup, aria-expanded, and aria-controls
 * automatically. Children are rendered inside the trigger button.
 */
export function Combobox({
  items,
  value,
  onSelect,
  children,
  onOpen,
  disabled,
  filterPlaceholder,
  emptyText,
  renderItem,
  className,
  triggerClassName,
}: ComboboxProps) {
  const [state, dispatch] = useReducer(comboboxReducer, { open: false, filter: '', highlighted: 0 })
  const { open, filter, highlighted } = state

  const containerRef = useRef<HTMLDivElement>(null)
  const filterRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const dropdownId = useId()

  const filtered = items.filter((item) =>
    item.toLowerCase().includes(filter.toLowerCase())
  )

  const handleOpen = useCallback(() => {
    if (disabled) return
    if (!open) onOpen?.()
    dispatch({ type: 'TOGGLE' })
  }, [disabled, open, onOpen])

  const close = useCallback(() => {
    dispatch({ type: 'CLOSE' })
  }, [])

  const selectItem = useCallback((item: string) => {
    onSelect(item)
    close()
  }, [onSelect, close])

  // Outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, close])

  // Auto-focus filter input
  useEffect(() => {
    if (open) requestAnimationFrame(() => filterRef.current?.focus())
  }, [open])

  // Scroll highlighted into view
  useEffect(() => {
    if (!listRef.current) return
    const el = listRef.current.children[highlighted] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [highlighted])

  const handleFilterKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        dispatch({ type: 'HIGHLIGHT_NEXT', max: filtered.length - 1 })
        break
      case 'ArrowUp':
        e.preventDefault()
        dispatch({ type: 'HIGHLIGHT_PREV' })
        break
      case 'Enter':
        e.preventDefault()
        if (filtered[highlighted]) selectItem(filtered[highlighted])
        break
      case 'Escape':
        close()
        break
    }
  }, [filtered, highlighted, selectItem, close])

  const wrapperClasses = ['combobox', className].filter(Boolean).join(' ')

  return (
    <div className={wrapperClasses} ref={containerRef}>
      <button
        type="button"
        className={triggerClassName ?? 'combobox-trigger'}
        onClick={handleOpen}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? dropdownId : undefined}
      >
        {children}
      </button>

      {open && items.length > 0 && (
        <div className="combobox-dropdown" id={dropdownId}>
          <input
            ref={filterRef}
            className="combobox-filter"
            value={filter}
            onChange={(e) => dispatch({ type: 'SET_FILTER', filter: e.target.value })}
            onKeyDown={handleFilterKeyDown}
            placeholder={filterPlaceholder}
            spellCheck={false}
            aria-label={filterPlaceholder}
          />
          <ul className="combobox-list" ref={listRef} role="listbox">
            {filtered.length === 0 ? (
              <li className="combobox-empty">{emptyText ?? 'No results'}</li>
            ) : (
              filtered.map((item, i) => {
                const isSelected = item === value
                const isHighlighted = i === highlighted
                return (
                  <li
                    key={item}
                    role="option"
                    aria-selected={isSelected}
                    className={[
                      'combobox-item',
                      isSelected && 'combobox-item--selected',
                      isHighlighted && 'combobox-item--highlighted',
                    ].filter(Boolean).join(' ')}
                    onMouseEnter={() => dispatch({ type: 'SET_HIGHLIGHTED', index: i })}
                    onMouseDown={(e) => { e.preventDefault(); selectItem(item) }}
                  >
                    {renderItem
                      ? renderItem(item, { isSelected, isHighlighted })
                      : item}
                  </li>
                )
              })
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
