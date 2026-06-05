import type { MutableRefObject } from 'react'
import { useTranslation } from 'react-i18next'
import type { Project } from '@/types'
import { Badge, Button } from '@/components/ui'
import {
  IconCheckCircle,
  IconClock,
  IconClose,
  IconExternalLinkSmall,
  IconGitBranch,
  IconGitHub,
  IconRefresh,
  IconSearch,
  IconXCircleStatus,
} from '@/components/shared/icons'
import { PRESETS, PER_REPO_LIMIT } from './constants'
import { RepoMultiPicker } from './RepoMultiPicker'
import type { FilterSuggestion, QuickFilter, TaskFilterPill, TaskRow } from './types'
import { formatRelativeTime } from '@/lib/relativeTime'
import { formatState, mergeVariant, stateLabel, stateVariant, upsertQueryToken } from './taskUtils'

export interface TaskListViewProps {
  projects: Project[]
  rows: TaskRow[]
  query: string
  activePresetId: string | null
  countLoading: boolean
  taskCountLabel: string
  counts: { prs: number; issues: number }
  activeFilterPills: TaskFilterPill[]
  repoFilters: string[]
  errorCount: number
  loading: boolean
  tableWrapClass: string
  canLoadMoreTasks: boolean
  totalTaskCount: number | null
  perRepoLimit: number
  filtersOpen: boolean
  activeFilterCount: number
  authorLogins: string[]
  effectiveSelectedProjectIds: ReadonlySet<string>
  showSuggestions: boolean
  filterSuggestions: FilterSuggestion[]
  highlightedSuggestion: number
  creatingWorktreeForRowId: string | null
  queryInputRef: MutableRefObject<HTMLInputElement | null>
  filtersRef: MutableRefObject<HTMLDivElement | null>
  setQuery: (value: string) => void
  setQueryCursor: (value: number) => void
  setSuggestionsOpen: (value: boolean) => void
  setFiltersOpen: (value: boolean | ((current: boolean) => boolean)) => void
  setHighlightedSuggestion: (value: number) => void
  handleRepoSelectionChange: (nextIds: ReadonlySet<string>) => void
  handleSelectAllRepos: () => void
  handleApplyQuickFilter: (filter: QuickFilter) => void
  replaceQuery: (nextQuery: string, focusSearch?: boolean) => void
  handleQueryChange: (event: React.ChangeEvent<HTMLInputElement>) => void
  handleQueryKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  handleClearQuery: () => void
  handleApplySuggestion: (suggestion: FilterSuggestion) => void
  handleClearRepoFilters: () => void
  fetchTasks: (forceRefresh?: boolean) => void
  handleOpenRow: (row: TaskRow) => void
  handleOpenGitHub: (event: React.MouseEvent, url: string) => void
  handleCreateWorktreeForRow: (row: TaskRow) => void
  handleLoadMore: () => void
}

export function TaskListView(props: TaskListViewProps) {
  const {
    projects, rows, query, activePresetId, countLoading, taskCountLabel, counts,
    activeFilterPills, repoFilters, errorCount, loading, tableWrapClass,
    canLoadMoreTasks, totalTaskCount, perRepoLimit, filtersOpen, activeFilterCount,
    authorLogins, effectiveSelectedProjectIds, showSuggestions, filterSuggestions,
    highlightedSuggestion, creatingWorktreeForRowId, queryInputRef, filtersRef,
    setQuery, setQueryCursor, setSuggestionsOpen, setFiltersOpen,
    setHighlightedSuggestion, handleRepoSelectionChange, handleSelectAllRepos,
    handleApplyQuickFilter, replaceQuery, handleQueryChange, handleQueryKeyDown,
    handleClearQuery, handleApplySuggestion, handleClearRepoFilters, fetchTasks,
    handleOpenRow, handleOpenGitHub, handleCreateWorktreeForRow, handleLoadMore,
  } = props
  const { t } = useTranslation('tasks')

  return (
    <div className="pull-requests-body">
      <div className="pull-requests-toolbar">
        <div className="pr-filter-tabs">
          {PRESETS.map((preset) => (
            <button key={preset.id} className={activePresetId === preset.id ? 'active' : ''} onClick={() => {
              setQuery(preset.query)
              setQueryCursor(preset.query.length)
              setSuggestionsOpen(false)
            }}>
              {t(preset.labelKey)}
            </button>
          ))}
        </div>

        <RepoMultiPicker projects={projects} selectedIds={effectiveSelectedProjectIds} onChange={handleRepoSelectionChange} onSelectAll={handleSelectAllRepos} />

        <div className="task-filter-menu" ref={filtersRef}>
          <button
            type="button"
            className={activeFilterCount > 0 ? 'task-filter-menu-trigger active' : 'task-filter-menu-trigger'}
            onClick={() => setFiltersOpen((current) => !current)}
            aria-expanded={filtersOpen}
            aria-label={t('filters.openGitHubFilters')}
          >
            <IconSearch size={12} />
            <span>{t('filters.filters')}</span>
            {activeFilterCount > 0 && <em>{activeFilterCount}</em>}
          </button>
          {filtersOpen && (
            <div className="task-filter-menu-popover">
              <div className="task-filter-menu-section">
                <span>{t('filters.people')}</span>
                <button onClick={() => handleApplyQuickFilter('author:@me')}>{t('filters.authorMe')}</button>
                <button onClick={() => handleApplyQuickFilter('assignee:@me')}>{t('filters.assigneeMe')}</button>
                <button onClick={() => handleApplyQuickFilter('review-requested:@me')}>{t('filters.reviewRequestedMe')}</button>
                <button onClick={() => handleApplyQuickFilter('reviewed-by:@me')}>{t('filters.reviewedByMe')}</button>
                {authorLogins.slice(0, 6).map((author) => (
                  <button key={author} onClick={() => replaceQuery(upsertQueryToken(query, `author:${author}` as QuickFilter))}>
                    {t('filters.author', { author })}
                  </button>
                ))}
              </div>
              <div className="task-filter-menu-section">
                <span>{t('filters.status')}</span>
                <button onClick={() => handleApplyQuickFilter('is:open')}>{t('filters.open')}</button>
                <button onClick={() => handleApplyQuickFilter('is:closed')}>{t('filters.closed')}</button>
                <button onClick={() => handleApplyQuickFilter('is:merged')}>{t('filters.merged')}</button>
                <button onClick={() => handleApplyQuickFilter('is:draft')}>{t('filters.draft')}</button>
              </div>
              <div className="task-filter-menu-section">
                <span>{t('filters.type')}</span>
                <button onClick={() => handleApplyQuickFilter('is:pr')}>{t('filters.pullRequests')}</button>
                <button onClick={() => handleApplyQuickFilter('is:issue')}>{t('filters.issues')}</button>
              </div>
            </div>
          )}
        </div>

        <div className="pr-search">
          <IconSearch size={13} />
          <input
            ref={queryInputRef}
            value={query}
            onChange={handleQueryChange}
            onClick={(event) => setQueryCursor(event.currentTarget.selectionStart ?? query.length)}
            onFocus={(event) => {
              setQueryCursor(event.currentTarget.selectionStart ?? query.length)
              setSuggestionsOpen(true)
            }}
            onBlur={() => setSuggestionsOpen(false)}
            onKeyDown={handleQueryKeyDown}
            placeholder={t('filters.searchPlaceholder')}
            role="combobox"
            aria-expanded={showSuggestions}
            aria-controls="task-filter-suggestions"
            aria-autocomplete="list"
            aria-activedescendant={showSuggestions ? `task-filter-suggestion-${highlightedSuggestion}` : undefined}
          />
          {query && <button className="pr-search-clear" onClick={handleClearQuery} aria-label={t('clearSearch')}><IconClose size={8} /></button>}
          {showSuggestions && (
            <div className="task-filter-suggestions" id="task-filter-suggestions" role="listbox" aria-label={t('filters.suggestionsAria')}>
              {filterSuggestions.map((suggestion, index) => (
                <button
                  key={`${suggestion.value}:${suggestion.description}`}
                  id={`task-filter-suggestion-${index}`}
                  className={['task-filter-suggestion', index === highlightedSuggestion ? 'task-filter-suggestion--active' : null].filter(Boolean).join(' ')}
                  role="option"
                  aria-selected={index === highlightedSuggestion}
                  onMouseEnter={() => setHighlightedSuggestion(index)}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    handleApplySuggestion(suggestion)
                  }}
                >
                  <span className="task-filter-suggestion__value">{suggestion.value}</span>
                  <span className="task-filter-suggestion__description">{suggestion.description}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <Button size="icon-sm" onClick={() => fetchTasks(true)} aria-label={t('refreshTasks')} loading={loading}>
          {!loading && <IconRefresh size={14} />}
        </Button>
      </div>

      <div className="task-summary-row">
        <Badge variant="accent" size="sm">{countLoading ? t('taskCount', { count: rows.length }) : taskCountLabel}</Badge>
        <Badge variant="muted" size="sm">{t('prCount', { count: counts.prs })}</Badge>
        <Badge variant="muted" size="sm">{t('issueCount', { count: counts.issues })}</Badge>
        {activeFilterPills.map((pill) => (
          <button key={`${pill.key}:${pill.value}`} className="task-filter-pill" onClick={pill.clear} aria-label={t('filters.clearFilterAria', { filter: pill.label })}>
            <span>{pill.label}:{pill.value}</span>
            <IconClose size={8} />
          </button>
        ))}
        {repoFilters.length > 0 && (
          <button className="task-filter-pill" onClick={handleClearRepoFilters} aria-label={t('filters.clearRepositoryFilter')}>
            <span>repo:{repoFilters.join(', ')}</span>
            <IconClose size={8} />
          </button>
        )}
        {errorCount > 0 && <Badge variant="warning" size="sm">{t('repoFailureCount', { count: errorCount })}</Badge>}
      </div>

      <TaskTable
        rows={rows}
        loading={loading}
        tableWrapClass={tableWrapClass}
        creatingWorktreeForRowId={creatingWorktreeForRowId}
        handleOpenRow={handleOpenRow}
        handleOpenGitHub={handleOpenGitHub}
        handleCreateWorktreeForRow={handleCreateWorktreeForRow}
      />

      {(canLoadMoreTasks || perRepoLimit > PER_REPO_LIMIT) && (
        <div className="task-pagination-row">
          <span>{totalTaskCount === null ? t('pagination.showing', { count: rows.length }) : t('pagination.showingOfTotal', { count: rows.length, total: totalTaskCount })}</span>
          {canLoadMoreTasks && <Button size="sm" onClick={handleLoadMore} loading={loading}>{t('pagination.loadMore')}</Button>}
        </div>
      )}
    </div>
  )
}

function TaskTable({ rows, loading, tableWrapClass, creatingWorktreeForRowId, handleOpenRow, handleOpenGitHub, handleCreateWorktreeForRow }: {
  rows: TaskRow[]
  loading: boolean
  tableWrapClass: string
  creatingWorktreeForRowId: string | null
  handleOpenRow: (row: TaskRow) => void
  handleOpenGitHub: (event: React.MouseEvent, url: string) => void
  handleCreateWorktreeForRow: (row: TaskRow) => void
}) {
  const { t } = useTranslation('tasks')

  return (
    <div className={tableWrapClass} aria-busy={loading}>
      {loading && rows.length > 0 && <div className="pr-table-loading-bar" aria-hidden="true" />}
      <table className="pr-table">
        <colgroup>
          <col className="pr-col-id" />
          <col className="pr-col-title" />
          <col className="pr-col-author" />
          <col className="pr-col-status" />
          <col className="pr-col-merge" />
          <col className="pr-col-updated" />
          <col className="pr-col-action" />
        </colgroup>
        <thead>
          <tr>
            <th className="pr-col-id" scope="col">{t('table.id')}</th>
            <th className="pr-col-title" scope="col">{t('table.titleContext')}</th>
            <th className="pr-col-author" scope="col">{t('table.author')}</th>
            <th className="pr-col-status" scope="col">{t('table.status')}</th>
            <th className="pr-col-merge" scope="col">{t('table.merge')}</th>
            <th className="pr-col-updated" scope="col">{t('table.updated')}</th>
            <th className="pr-col-action" scope="col" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr className="pr-table-row" key={`${row.projectId}:${row.item.id}`} onClick={() => handleOpenRow(row)}>
              <td className="pr-col-id" data-label={t('table.id')}>
                <span className={`pr-number pr-number--${row.item.type}`}>
                  <span className="pr-number-type">{row.item.type === 'pr' ? t('type.prShort') : t('type.issueShort')}</span>
                  <span className="pr-number-value">#{row.item.number}</span>
                </span>
              </td>
              <td className="pr-col-title" data-label={t('table.title')}>
                <div className="pr-title-line" title={row.item.title}>{row.item.title}</div>
                <div className="pr-context-line" title={[row.projectName, row.matchingBranch].filter(Boolean).join(' / ')}>
                  <IconGitBranch size={11} />
                  <span className="pr-context-repo">{row.projectName}</span>
                  {row.matchingBranch && <span className="pr-context-branch">{row.matchingBranch}</span>}
                </div>
              </td>
              <td className="pr-col-author" data-label={t('table.author')}>
                <span className="pr-author">
                  <span className="pr-author-avatar" aria-hidden="true">{getAuthorInitial(row.item.author)}</span>
                  <span className="pr-author-login">{row.item.author || t('unknown')}</span>
                </span>
              </td>
              <td className="pr-col-status" data-label={t('table.status')}>
                <Badge variant={stateVariant(row.item)} size="sm">
                  {row.item.state === 'open' ? <IconCheckCircle size={12} /> : <IconXCircleStatus size={12} />}
                  {stateLabel(row.item, t)}
                </Badge>
              </td>
              <td className="pr-col-merge" data-label={t('table.merge')}>
                {row.item.type === 'pr'
                  ? <Badge variant={mergeVariant(row.item.mergeStateStatus)} size="sm">{formatState(row.item.mergeStateStatus, t)}</Badge>
                  : <Badge variant="muted" size="sm">{t('type.issue')}</Badge>}
              </td>
              <td className="pr-col-updated pr-updated" data-label={t('table.updated')}>
                <span className="pr-updated-value">
                  <IconClock size={12} />
                  {row.item.updatedAt ? formatRelativeTime(row.item.updatedAt) : '-'}
                </span>
              </td>
              <td className="pr-col-action" data-label={t('table.actions')}>
                <div className="pr-row-actions">
                  {row.item.type === 'pr' && !row.matchingWorktreeId && row.item.headBranch && (
                    <button
                      className="pr-open-github"
                      onClick={(event) => {
                        event.stopPropagation()
                        handleCreateWorktreeForRow(row)
                      }}
                      disabled={creatingWorktreeForRowId !== null}
                      aria-label={t('table.startWorkspaceAria')}
                      title={t('table.startWorkspaceTitle')}
                    >
                      <IconGitBranch size={13} />
                    </button>
                  )}
                  {row.item.url && (
                    <button className="pr-open-github" onClick={(event) => handleOpenGitHub(event, row.item.url)} aria-label={t('table.openInGitHub')} title={t('table.openInGitHub')}>
                      <IconGitHub size={13} />
                      <IconExternalLinkSmall size={9} />
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
          {loading && rows.length === 0 && Array.from({ length: 8 }).map((_, index) => (
            <tr key={`task-skeleton-${index}`} className="pr-skeleton-row">
              <td className="pr-col-id"><span className="pr-skeleton pr-skeleton--id" /></td>
              <td className="pr-col-title"><span className="pr-skeleton pr-skeleton--title" /><span className="pr-skeleton pr-skeleton--context" /></td>
              <td className="pr-col-author"><span className="pr-skeleton pr-skeleton--author" /></td>
              <td className="pr-col-status"><span className="pr-skeleton pr-skeleton--badge" /></td>
              <td className="pr-col-merge"><span className="pr-skeleton pr-skeleton--merge" /></td>
              <td className="pr-col-updated"><span className="pr-skeleton pr-skeleton--updated" /></td>
              <td className="pr-col-action"><span className="pr-skeleton pr-skeleton--action" /></td>
            </tr>
          ))}
          {!loading && rows.length === 0 && (
            <tr><td className="pr-empty" colSpan={7}>{t('noTasks')}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function getAuthorInitial(author?: string | null): string {
  const trimmed = author?.trim()
  return trimmed ? trimmed.charAt(0).toUpperCase() : '?'
}
