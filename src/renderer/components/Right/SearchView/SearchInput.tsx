import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Tooltip } from '@/components/shared/Tooltip'
import { IconChevronRight, IconChevronDown } from '@/components/shared/icons'

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
  // Auto-expand filters if either field already has a value (e.g. after
  // a worktree switch where state was preserved). Default hidden so users
  // don't accidentally restrict searches by typing in the include field.
  const [showFilters, setShowFilters] = useState(() => !!(includeGlobs || excludeGlobs))
  const hasActiveFilters = !!(includeGlobs || excludeGlobs)

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
            <input
              type="text"
              className="search-input"
              placeholder={t('searchPlaceholder')}
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              autoFocus
            />
            <div className="search-modifier-group">
              <Tooltip content={t('searchMatchCase')} position="bottom">
                <button
                  type="button"
                  className={`search-modifier-btn${caseSensitive ? ' active' : ''}`}
                  onClick={() => onToggleOption('caseSensitive')}
                  aria-pressed={caseSensitive}
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
                >
                  .*
                </button>
              </Tooltip>
            </div>
          </div>

          {showReplace && (
            <div className="search-input-wrap">
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
        {showFilters ? <IconChevronDown size={10} /> : <IconChevronRight size={10} />}
        <span>{t('searchFiltersSection')}</span>
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
