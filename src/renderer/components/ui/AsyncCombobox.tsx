import { useReducer, useRef, useEffect, useCallback, useId, type ReactNode } from 'react'

interface AsyncComboboxProps {
  /** Currently selected item */
  value?: string
  /** Called when user picks an item */
  onSelect: (item: string) => void
  /** Async function returning the list of items. Called each time the dropdown opens. */
  fetchItems: () => Promise<string[]>
  /** Content rendered inside the trigger button */
  children: ReactNode
  /** Called when the dropdown open state changes (useful for hiding parent tooltips) */
  onOpenChange?: (open: boolean) => void
  /** Disable the trigger */
  disabled?: boolean
  /** Placeholder for the search/filter input */
  filterPlaceholder?: string
  /** Text shown when fetch returns no items or filter matches nothing */
  emptyText?: string
  /** Custom item renderer - default shows label with accent color for selected */
  renderItem?: (item: string, state: { isSelected: boolean; isHighlighted: boolean }) => ReactNode
  /** CSS class on the wrapper div */
  className?: string
  /** CSS class on the trigger button */
  triggerClassName?: string
}

type Status = 'idle' | 'loading' | 'loaded'

type State = {
  open: boolean
  status: Status
  items: string[]
  filter: string
  highlighted: number
}

type Action =
  | { type: 'OPEN' }
  | { type: 'CLOSE' }
  | { type: 'LOADED'; items: string[] }
  | { type: 'SET_FILTER'; filter: string }
  | { type: 'SET_HIGHLIGHTED'; index: number }
  | { type: 'HIGHLIGHT_NEXT'; max: number }
  | { type: 'HIGHLIGHT_PREV' }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'OPEN': return { ...state, open: true, status: 'loading', filter: '', highlighted: 0 }
    case 'CLOSE': return { ...state, open: false, status: 'idle', filter: '' }
    case 'LOADED': return { ...state, status: 'loaded', items: action.items }
    case 'SET_FILTER': return { ...state, filter: action.filter, highlighted: 0 }
    case 'SET_HIGHLIGHTED': return { ...state, highlighted: action.index }
    case 'HIGHLIGHT_NEXT': return { ...state, highlighted: Math.min(state.highlighted + 1, action.max) }
    case 'HIGHLIGHT_PREV': return { ...state, highlighted: Math.max(state.highlighted - 1, 0) }
  }
}

const INITIAL: State = { open: false, status: 'idle', items: [], filter: '', highlighted: 0 }

/**
 * Searchable dropdown that fetches items asynchronously on open.
 *
 * Unlike `Combobox` (which takes a static `items` array), `AsyncCombobox`
 * accepts a `fetchItems` callback and manages loading/loaded/error states
 * internally. This avoids cross-component state coordination issues that
 * occur when loading state lives in the parent and open state in the child.
 *
 * Shows a loading indicator immediately on click, then transitions to the
 * filter + list once `fetchItems` resolves. Stale responses from earlier
 * fetches are discarded.
 */
export function AsyncCombobox({
  value,
  onSelect,
  fetchItems,
  children,
  onOpenChange,
  disabled,
  filterPlaceholder,
  emptyText,
  renderItem,
  className,
  triggerClassName,
}: AsyncComboboxProps) {
  const [state, dispatch] = useReducer(reducer, INITIAL)
  const { open, status, items, filter, highlighted } = state

  const containerRef = useRef<HTMLDivElement>(null)
  const filterRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const fetchIdRef = useRef(0)
  const dropdownId = useId()

  const filtered = items.filter((item) =>
    item.toLowerCase().includes(filter.toLowerCase())
  )

  const close = useCallback(() => {
    dispatch({ type: 'CLOSE' })
    onOpenChange?.(false)
  }, [onOpenChange])

  const handleToggle = useCallback(() => {
    if (disabled) return
    if (open) {
      close()
      return
    }
    dispatch({ type: 'OPEN' })
    onOpenChange?.(true)

    // Fetch items, guarding against stale responses
    const id = ++fetchIdRef.current
    fetchItems()
      .then((result) => { if (fetchIdRef.current === id) dispatch({ type: 'LOADED', items: result }) })
      .catch(() => { if (fetchIdRef.current === id) dispatch({ type: 'LOADED', items: [] }) })
  }, [disabled, open, close, onOpenChange, fetchItems])

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

  // Auto-focus filter input once items are loaded
  useEffect(() => {
    if (open && status === 'loaded') {
      requestAnimationFrame(() => filterRef.current?.focus())
    }
  }, [open, status])

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
        onClick={handleToggle}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? dropdownId : undefined}
      >
        {children}
      </button>

      {open && (
        <div className="combobox-dropdown" id={dropdownId}>
          {status === 'loading' ? (
            <div className="combobox-loading">
              <div className="combobox-loading-dot" />
              <div className="combobox-loading-dot" />
              <div className="combobox-loading-dot" />
            </div>
          ) : (
            <>
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
            </>
          )}
        </div>
      )}
    </div>
  )
}
