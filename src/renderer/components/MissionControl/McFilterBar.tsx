import { useState, useRef, useEffect, useCallback, memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useMissionControlStore } from '@/store/missionControl'
import { Button, Checkbox } from '@/components/ui'
import { IconSearch, IconChevronDown, IconClose } from '@/components/shared/icons'

interface Project {
  id: string
  name: string
}

interface Props {
  projects: Project[]
}

export const McFilterBar = memo(function McFilterBar({ projects }: Props) {
  const { t } = useTranslation('missionControl')
  const filterQuery = useMissionControlStore((s) => s.filterQuery)
  const filterProjectIds = useMissionControlStore((s) => s.filterProjectIds)
  const setFilterQuery = useMissionControlStore((s) => s.setFilterQuery)
  const toggleFilterProject = useMissionControlStore((s) => s.toggleFilterProject)
  const clearFilters = useMissionControlStore((s) => s.clearFilters)

  const [localQuery, setLocalQuery] = useState(filterQuery)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const hasActiveFilters = filterQuery !== '' || filterProjectIds.size > 0

  // Debounce search input
  const handleQueryChange = useCallback((value: string) => {
    setLocalQuery(value)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setFilterQuery(value), 150)
  }, [setFilterQuery])

  // Clear search field inline
  const handleClearSearch = useCallback(() => {
    setLocalQuery('')
    setFilterQuery('')
    searchRef.current?.focus()
  }, [setFilterQuery])

  // Sync local query when store clears
  useEffect(() => {
    if (filterQuery === '' && localQuery !== '') setLocalQuery('')
  }, [filterQuery]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [dropdownOpen])

  // Cmd/Ctrl+F to focus search
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Escape to clear search or close dropdown
  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (localQuery) {
        handleClearSearch()
      } else {
        searchRef.current?.blur()
      }
    }
  }, [localQuery, handleClearSearch])

  // Cleanup debounce on unmount
  useEffect(() => () => clearTimeout(debounceRef.current), [])

  const projectLabel = filterProjectIds.size === 0
    ? t('filterAllProjects')
    : t('filterProjectCount', { count: filterProjectIds.size })

  return (
    <div className="mc-filter-bar">
      <div className="mc-filter-search-wrap">
        <span className="mc-filter-search-icon">
          <IconSearch size={12} />
        </span>
        <input
          ref={searchRef}
          className="mc-filter-search"
          type="text"
          value={localQuery}
          onChange={(e) => handleQueryChange(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          placeholder={t('filterSearch')}
        />
        {localQuery && (
          <button
            className="mc-filter-search-clear"
            onClick={handleClearSearch}
            tabIndex={-1}
          >
            <IconClose size={8} />
          </button>
        )}
      </div>

      {projects.length > 1 && (
        <div className="mc-filter-dropdown" ref={dropdownRef}>
          <button
            className={`mc-filter-project-btn${filterProjectIds.size > 0 ? ' mc-filter-project-btn--active' : ''}`}
            onClick={() => setDropdownOpen((o) => !o)}
          >
            {projectLabel}
            <span className={`mc-filter-chevron${dropdownOpen ? ' mc-filter-chevron--open' : ''}`}>
              <IconChevronDown size={8} />
            </span>
          </button>
          {dropdownOpen && (
            <div className="mc-filter-project-popover">
              {projects.map((p) => (
                <label key={p.id} className="mc-filter-project-option">
                  <Checkbox
                    size="sm"
                    checked={filterProjectIds.has(p.id)}
                    onChange={() => toggleFilterProject(p.id)}
                  />
                  <span>{p.name}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {hasActiveFilters && (
        <Button size="sm" className="mc-filter-clear" onClick={clearFilters}>
          <IconClose size={8} />
          {t('filterClear')}
        </Button>
      )}
    </div>
  )
})
