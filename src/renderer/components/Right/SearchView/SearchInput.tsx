import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Tooltip } from '@/components/shared/Tooltip'
import { IconChevronRight, IconChevronDown, IconClose, IconSearch, IconSliders } from '@/components/shared/icons'

type OptionKey = 'caseSensitive' | 'wholeWord' | 'regex'

interface Props {
  query: string
  replacement: string
  showReplace: boolean
  includeGlobs: string
  excludeGlobs: string
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
  canReplaceAll: boolean
  onQueryChange: (v: string) => void
  onReplacementChange: (v: string) => void
  onToggleReplace: () => void
  onIncludeChange: (v: string) => void
  onExcludeChange: (v: string) => void
  onToggleOption: (key: OptionKey) => void
  onReplaceAll: () => void
}

export function SearchInput({
  query,
  replacement,
  showReplace,
  includeGlobs,
  excludeGlobs,
  caseSensitive,
  wholeWord,
  regex,
  canReplaceAll,
  onQueryChange,
  onReplacementChange,
  onToggleReplace,
  onIncludeChange,
  onExcludeChange,
  onToggleOption,
  onReplaceAll,
}: Props) {
  const { t } = useTranslation('right')
  const queryRef = useRef<HTMLInputElement>(null)
  // Auto-expand filters if either field already has a value (e.g. after
  // a worktree switch where state was preserved). Default hidden so users
  // don't accidentally restrict searches by typing in the include field.
  const [showFilters, setShowFilters] = useState(() => !!(includeGlobs || excludeGlobs))
  const hasActiveFilters = !!(includeGlobs || excludeGlobs)

  useEffect(() => {
    if (hasActiveFilters) setShowFilters(true)
  }, [hasActiveFilters])

  const handleClearQuery = () => {
    onQueryChange('')
    queryRef.current?.focus()
  }

  return (
    <div className="search-input-section">
      <div className="search-input-row">
        <button
          type="button"
          className="search-replace-toggle"
          onClick={onToggleReplace}
          title={t('searchToggleReplace')}
        >
          {showReplace ? <IconChevronDown size={10} /> : <IconChevronRight size={10} />}
        </button>
        <div className="search-input-stack">
          <div className="search-input-wrap">
            <span className="search-input-icon" aria-hidden="true">
              <IconSearch size={13} />
            </span>
            <input
              ref={queryRef}
              type="text"
              className="search-input"
              placeholder={t('searchPlaceholder')}
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && query) {
                  e.preventDefault()
                  e.stopPropagation()
                  handleClearQuery()
                }
              }}
              autoFocus
            />
            {query && (
              <button
                type="button"
                className="search-input-clear"
                onClick={handleClearQuery}
                aria-label={t('searchClear')}
                title={t('searchClear')}
              >
                <IconClose size={8} />
              </button>
            )}
            <div className="search-modifier-group">
              <Tooltip content={t('searchMatchCase')} position="bottom">
                <button
                  type="button"
                  className={`search-modifier-btn${caseSensitive ? ' active' : ''}`}
                  onClick={() => onToggleOption('caseSensitive')}
                  aria-pressed={caseSensitive}
                  aria-label={t('searchMatchCase')}
                >
                  Aa
                </button>
              </Tooltip>
              <Tooltip content={t('searchWholeWord')} position="bottom">
                <button
                  type="button"
                  className={`search-modifier-btn${wholeWord ? ' active' : ''}`}
                  onClick={() => onToggleOption('wholeWord')}
                  aria-pressed={wholeWord}
                  aria-label={t('searchWholeWord')}
                >
                  <span style={{ textDecoration: 'underline' }}>ab</span>
                </button>
              </Tooltip>
              <Tooltip content={t('searchRegex')} position="bottom">
                <button
                  type="button"
                  className={`search-modifier-btn${regex ? ' active' : ''}`}
                  onClick={() => onToggleOption('regex')}
                  aria-pressed={regex}
                  aria-label={t('searchRegex')}
                >
                  .*
                </button>
              </Tooltip>
            </div>
          </div>

          {showReplace && (
            <div className="search-input-wrap search-input-wrap--replace">
              <input
                type="text"
                className="search-input"
                placeholder={t('searchReplacePlaceholder')}
                value={replacement}
                onChange={(e) => onReplacementChange(e.target.value)}
              />
              <button
                type="button"
                className="search-replace-all-btn"
                onClick={onReplaceAll}
                disabled={!canReplaceAll}
                title={t('searchReplaceAll')}
              >
                {t('searchReplaceAll')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Collapsible file filter section — hidden by default to prevent
          accidental use of the include field (which restricts rg to only
          those files, hiding all other results). */}
      <button
        type="button"
        className={`search-filter-section-toggle${hasActiveFilters ? ' has-active' : ''}`}
        onClick={() => setShowFilters((v) => !v)}
        title={t('searchToggleFilters')}
        aria-expanded={showFilters}
      >
        <IconSliders size={13} />
        <span>{t('searchFiltersSection')}</span>
        <span className="search-filter-toggle-chevron" aria-hidden="true">
          {showFilters ? <IconChevronDown size={10} /> : <IconChevronRight size={10} />}
        </span>
        {hasActiveFilters && <span className="search-filter-active-dot" aria-hidden="true" />}
      </button>

      {showFilters && (
        <div className="search-filters">
          <label htmlFor="search-include-filter" className="search-filter-label">{t('searchIncludeLabel')}</label>
          <input
            id="search-include-filter"
            type="text"
            className="search-input search-input--filter"
            value={includeGlobs}
            onChange={(e) => onIncludeChange(e.target.value)}
            placeholder="*.ts, src/**/*.tsx"
          />
          <label htmlFor="search-exclude-filter" className="search-filter-label">{t('searchExcludeLabel')}</label>
          <input
            id="search-exclude-filter"
            type="text"
            className="search-input search-input--filter"
            value={excludeGlobs}
            onChange={(e) => onExcludeChange(e.target.value)}
            placeholder="**/*.test.ts, dist/**"
          />
        </div>
      )}
    </div>
  )
}
