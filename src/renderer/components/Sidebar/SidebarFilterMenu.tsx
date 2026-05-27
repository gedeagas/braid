import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useUIStore, type SidebarGroupBy, type SidebarSortBy } from '@/store/ui'
import { Tooltip } from '@/components/shared/Tooltip'
import { Toggle } from '@/components/shared/Toggle'
import { IconCheckmark, IconChevronDown, IconClose, IconSearch, IconSliders } from '@/components/shared/icons'

const POPOVER_WIDTH = 286
const POPOVER_MARGIN = 8

type PopoverRect = {
  top: number
  left: number
  width: number
}

export function SidebarFilterMenu() {
  const { t } = useTranslation('sidebar')
  const groupBy = useUIStore((s) => s.sidebarGroupBy)
  const sortBy = useUIStore((s) => s.sidebarSortBy)
  const query = useUIStore((s) => s.sidebarFilterQuery)
  const hideSleeping = useUIStore((s) => s.sidebarHideSleeping)
  const hideDefaultBranch = useUIStore((s) => s.sidebarHideDefaultBranch)
  const setGroupBy = useUIStore((s) => s.setSidebarGroupBy)
  const setSortBy = useUIStore((s) => s.setSidebarSortBy)
  const setQuery = useUIStore((s) => s.setSidebarFilterQuery)
  const setHideSleeping = useUIStore((s) => s.setSidebarHideSleeping)
  const setHideDefaultBranch = useUIStore((s) => s.setSidebarHideDefaultBranch)
  const clearFilters = useUIStore((s) => s.clearSidebarFilters)

  const [open, setOpen] = useState(false)
  const [sortOpen, setSortOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [popoverRect, setPopoverRect] = useState<PopoverRect>({ top: 0, left: 0, width: POPOVER_WIDTH })
  const hasActiveFilters = (
    groupBy !== 'project' ||
    sortBy !== 'manual' ||
    query.trim() !== '' ||
    hideSleeping ||
    hideDefaultBranch
  )

  const groupOptions: Array<{ value: SidebarGroupBy; label: string }> = [
    { value: 'none', label: t('groupByNone') },
    { value: 'status', label: t('groupByStatus') },
    { value: 'pr', label: t('groupByPr') },
    { value: 'project', label: t('groupByProject') },
  ]
  const sortOptions: Array<{ value: SidebarSortBy; label: string }> = [
    { value: 'manual', label: t('sortManual') },
    { value: 'recent', label: t('sortRecent') },
    { value: 'name', label: t('sortName') },
  ]
  const activeSortLabel = sortOptions.find((option) => option.value === sortBy)?.label ?? t('sortManual')

  const updatePopoverRect = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const triggerRect = trigger.getBoundingClientRect()
    const width = Math.min(POPOVER_WIDTH, window.innerWidth - POPOVER_MARGIN * 2)
    const maxLeft = window.innerWidth - width - POPOVER_MARGIN
    const left = Math.max(POPOVER_MARGIN, Math.min(triggerRect.right - width, maxLeft))
    setPopoverRect({
      top: triggerRect.bottom + 6,
      left,
      width,
    })
  }, [])

  useEffect(() => {
    if (!open) return
    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node
      if (rootRef.current?.contains(target) || popoverRef.current?.contains(target)) return
      setOpen(false)
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open) return
    updatePopoverRect()
    window.addEventListener('resize', updatePopoverRect)
    window.addEventListener('scroll', updatePopoverRect, true)
    return () => {
      window.removeEventListener('resize', updatePopoverRect)
      window.removeEventListener('scroll', updatePopoverRect, true)
    }
  }, [open, updatePopoverRect])

  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => searchRef.current?.focus())
  }, [open])

  useEffect(() => {
    if (!open) setSortOpen(false)
  }, [open])

  const handleSearchKeyDown = useCallback((e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    if (query.trim() !== '') {
      e.stopPropagation()
      setQuery('')
    } else {
      setOpen(false)
    }
  }, [query, setQuery])

  return (
    <div ref={rootRef} className="sidebar-filter-menu">
      <Tooltip content={t('projectFilters')} position="bottom" disabled={open}>
        <button
          ref={triggerRef}
          className={`sidebar-filter-trigger${hasActiveFilters ? ' sidebar-filter-trigger--active' : ''}`}
          aria-label={t('projectFilters')}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <IconSliders size={14} />
          {hasActiveFilters && <span className="sidebar-filter-active-dot" aria-hidden="true" />}
        </button>
      </Tooltip>

      {open && createPortal(
        <div
          ref={popoverRef}
          className="sidebar-filter-popover"
          role="dialog"
          aria-label={t('projectFilters')}
          style={{ top: popoverRect.top, left: popoverRect.left, width: popoverRect.width }}
        >
          <div className="sidebar-filter-section">
            <div className="sidebar-filter-section-title">{t('groupBy')}</div>
            <div className="sidebar-filter-segmented" role="group" aria-label={t('groupBy')}>
              {groupOptions.map((option) => (
                <button
                  key={option.value}
                  className={`sidebar-filter-segmented-btn${groupBy === option.value ? ' sidebar-filter-segmented-btn--active' : ''}`}
                  onClick={() => setGroupBy(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="sidebar-filter-section">
            <button
              className="sidebar-filter-sort-row"
              aria-expanded={sortOpen}
              onClick={() => setSortOpen((value) => !value)}
            >
              <span>{t('sortBy')}</span>
              <span className="sidebar-filter-sort-value">
                {activeSortLabel}
                <IconChevronDown size={9} />
              </span>
            </button>
            {sortOpen && (
              <div className="sidebar-filter-sort-options">
                {sortOptions.map((option) => (
                  <button
                    key={option.value}
                    className="sidebar-filter-sort-option"
                    onClick={() => {
                      setSortBy(option.value)
                      setSortOpen(false)
                    }}
                  >
                    <span>{option.label}</span>
                    {sortBy === option.value && <IconCheckmark size={12} />}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="sidebar-filter-search-wrap">
            <span className="sidebar-filter-search-icon" aria-hidden="true">
              <IconSearch size={12} />
            </span>
            <input
              ref={searchRef}
              className="sidebar-filter-search"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder={t('filterByNamePlaceholder')}
              aria-label={t('filterByName')}
            />
            {query && (
              <button
                className="sidebar-filter-search-clear"
                aria-label={t('clearSearch')}
                onClick={() => {
                  setQuery('')
                  searchRef.current?.focus()
                }}
              >
                <IconClose size={8} />
              </button>
            )}
          </div>

          <div className="sidebar-filter-section">
            <div className="sidebar-filter-section-title">{t('filters')}</div>
            <div className="sidebar-filter-row">
              <span>{t('hideSleeping')}</span>
              <Toggle checked={hideSleeping} onChange={setHideSleeping} />
            </div>
            <div className="sidebar-filter-row">
              <span>{t('hideDefaultBranch')}</span>
              <Toggle checked={hideDefaultBranch} onChange={setHideDefaultBranch} />
            </div>
          </div>

          {hasActiveFilters && (
            <button className="sidebar-filter-clear-all" onClick={clearFilters}>
              {t('clearProjectFilters')}
            </button>
          )}
        </div>,
        document.body
      )}
    </div>
  )
}
