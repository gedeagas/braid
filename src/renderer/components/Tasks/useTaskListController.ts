import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Project } from '@/types'
import * as ipc from '@/lib/ipc'
import { getRepoQualifiers, parseTaskQuery, stripRepoQualifiers } from '@shared/task-query'
import { DEFAULT_QUERY, MAX_PER_REPO_LIMIT, PER_REPO_LIMIT } from './constants'
import type { FilterSuggestion, QuickFilter, TaskFilterPill, TaskRow } from './types'
import {
  applyFilterSuggestion,
  buildRepoFilterOptions,
  findFilterSuggestions,
  formatState,
  getCurrentTokenRange,
  getPresetId,
  getQuickFilterMatcher,
  removeQueryTokens,
  resolveSelectedProjectIds,
  upsertQueryToken,
} from './taskUtils'

interface UseTaskListControllerArgs {
  projects: Project[]
  tasksActive: boolean
  toggleTasks: () => void
  selectWorktree: (projectId: string, worktreeId: string) => void
  setSelectedRow: (row: TaskRow | null) => void
}

export function useTaskListController(args: UseTaskListControllerArgs) {
  const { projects, tasksActive, toggleTasks, selectWorktree, setSelectedRow } = args
  const { t } = useTranslation('tasks')
  const [query, setQuery] = useState(DEFAULT_QUERY)
  const [rows, setRows] = useState<TaskRow[]>([])
  const [loading, setLoading] = useState(false)
  const [errorCount, setErrorCount] = useState(0)
  const [totalTaskCount, setTotalTaskCount] = useState<number | null>(null)
  const [countLoading, setCountLoading] = useState(false)
  const [perRepoLimit, setPerRepoLimit] = useState(PER_REPO_LIMIT)
  const [queryCursor, setQueryCursor] = useState(DEFAULT_QUERY.length)
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [highlightedSuggestion, setHighlightedSuggestion] = useState(0)
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string> | null>(null)
  const queryInputRef = useRef<HTMLInputElement>(null)
  const filtersRef = useRef<HTMLDivElement>(null)
  const fetchSequenceRef = useRef(0)

  const activePresetId = getPresetId(query)
  const parsedQuery = useMemo(() => parseTaskQuery(stripRepoQualifiers(query)), [query])
  const repoFilterOptions = useMemo(() => buildRepoFilterOptions(projects), [projects])
  const repoFilters = useMemo(() => getRepoQualifiers(query), [query])
  const effectiveSelectedProjectIds = useMemo(
    () => resolveSelectedProjectIds(projects, selectedProjectIds, repoFilters),
    [projects, repoFilters, selectedProjectIds]
  )
  const filteredProjects = useMemo(
    () => projects.filter((project) => effectiveSelectedProjectIds.has(project.id)),
    [effectiveSelectedProjectIds, projects]
  )
  const currentTokenRange = useMemo(() => getCurrentTokenRange(query, queryCursor), [query, queryCursor])
  const filterSuggestions = useMemo(
    () => findFilterSuggestions(query, currentTokenRange, repoFilterOptions)
      .map((suggestion) => ({
        ...suggestion,
        description: suggestion.descriptionKey ? t(suggestion.descriptionKey) : suggestion.description,
      })),
    [currentTokenRange, query, repoFilterOptions, t]
  )
  const showSuggestions = suggestionsOpen && filterSuggestions.length > 0

  const fetchTasks = useCallback(async (forceRefresh = false) => {
    const requestId = fetchSequenceRef.current + 1
    fetchSequenceRef.current = requestId
    if (filteredProjects.length === 0) {
      setRows([])
      setErrorCount(0)
      setTotalTaskCount(0)
      setLoading(false)
      setCountLoading(false)
      return
    }

    setLoading(true)
    setCountLoading(true)
    const normalizedQuery = stripRepoQualifiers(query)
    const [results, countResults] = await Promise.all([
      Promise.allSettled(filteredProjects.map(async (project) => {
        const result = await ipc.github.listWorkItems(project.path, perRepoLimit, normalizedQuery, forceRefresh) as { items: TaskRow['item'][] }
        return result.items.map((item): TaskRow => {
          const matchingWorktree = item.type === 'pr' && item.headBranch
            ? project.worktrees.find((worktree) => worktree.branch === item.headBranch)
            : null
          return {
            projectId: project.id,
            projectName: project.name,
            repoPath: project.path,
            item,
            matchingWorktreeId: matchingWorktree?.id ?? null,
            matchingBranch: matchingWorktree?.branch ?? (item.type === 'pr' ? item.headBranch ?? null : null),
          }
        })
      })),
      Promise.allSettled(filteredProjects.map((project) => ipc.github.countWorkItems(project.path, normalizedQuery, forceRefresh) as Promise<number>)),
    ])
    if (fetchSequenceRef.current !== requestId) return

    const nextRows: TaskRow[] = []
    let failures = 0
    for (const result of results) result.status === 'fulfilled' ? nextRows.push(...result.value) : failures += 1
    let total = 0
    let hasCount = false
    for (const result of countResults) {
      if (result.status !== 'fulfilled') continue
      total += Number(result.value) || 0
      hasCount = true
    }
    nextRows.sort((a, b) => new Date(b.item.updatedAt || 0).getTime() - new Date(a.item.updatedAt || 0).getTime())
    setRows(nextRows)
    setErrorCount(failures)
    setTotalTaskCount(hasCount ? total : null)
    setLoading(false)
    setCountLoading(false)
  }, [filteredProjects, perRepoLimit, query])

  useEffect(() => setHighlightedSuggestion(0), [filterSuggestions])
  useEffect(() => setPerRepoLimit(PER_REPO_LIMIT), [effectiveSelectedProjectIds, query])
  useEffect(() => {
    if (tasksActive) void fetchTasks(false)
  }, [fetchTasks, tasksActive])
  useEffect(() => {
    if (!tasksActive) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !suggestionsOpen) toggleTasks()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [suggestionsOpen, tasksActive, toggleTasks])
  useEffect(() => {
    if (!filtersOpen) return
    const handlePointerDown = (event: globalThis.MouseEvent) => {
      if (!filtersRef.current?.contains(event.target as Node)) setFiltersOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [filtersOpen])

  const handleOpenRow = useCallback((row: TaskRow) => {
    if (row.item.type === 'pr') {
      setSelectedRow(row)
      return
    }
    if (row.matchingWorktreeId) {
      selectWorktree(row.projectId, row.matchingWorktreeId)
      toggleTasks()
      return
    }
    if (row.item.url) ipc.shell.openExternal(row.item.url)
  }, [selectWorktree, setSelectedRow, toggleTasks])

  const handleOpenGitHub = useCallback((event: React.MouseEvent, url: string) => {
    event.stopPropagation()
    ipc.shell.openExternal(url)
  }, [])

  const handleLoadMore = useCallback(() => {
    setPerRepoLimit((current) => Math.min(MAX_PER_REPO_LIMIT, current + PER_REPO_LIMIT))
  }, [])

  const handleApplySuggestion = useCallback((suggestion: FilterSuggestion) => {
    const next = applyFilterSuggestion(query, currentTokenRange, suggestion)
    setQuery(next.query)
    setQueryCursor(next.cursor)
    setSuggestionsOpen(true)
    requestAnimationFrame(() => {
      queryInputRef.current?.focus()
      queryInputRef.current?.setSelectionRange(next.cursor, next.cursor)
    })
  }, [currentTokenRange, query])

  const handleQueryChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value)
    setQueryCursor(event.target.selectionStart ?? event.target.value.length)
    setSuggestionsOpen(true)
  }, [])

  const handleQueryKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && showSuggestions) {
      event.preventDefault()
      setHighlightedSuggestion((current) => Math.min(current + 1, filterSuggestions.length - 1))
      return
    }
    if (event.key === 'ArrowUp' && showSuggestions) {
      event.preventDefault()
      setHighlightedSuggestion((current) => Math.max(current - 1, 0))
      return
    }
    if ((event.key === 'Tab' || event.key === 'Enter') && showSuggestions && currentTokenRange.value) {
      const suggestion = filterSuggestions[highlightedSuggestion]
      const exactToken = suggestion?.value.toLowerCase() === currentTokenRange.value.toLowerCase()
      if (suggestion && (event.key === 'Tab' || !exactToken)) {
        event.preventDefault()
        handleApplySuggestion(suggestion)
        return
      }
    }
    if (event.key === 'Enter') {
      setSuggestionsOpen(false)
      void fetchTasks(true)
      return
    }
    if (event.key === 'Escape' && showSuggestions) {
      event.preventDefault()
      setSuggestionsOpen(false)
    }
  }, [currentTokenRange.value, fetchTasks, filterSuggestions, handleApplySuggestion, highlightedSuggestion, showSuggestions])

  const handleClearQuery = useCallback(() => {
    setQuery('')
    setQueryCursor(0)
    setSuggestionsOpen(false)
    queryInputRef.current?.focus()
  }, [])

  const replaceQuery = useCallback((nextQuery: string, focusSearch = false) => {
    setQuery(nextQuery)
    setQueryCursor(nextQuery.length)
    setSuggestionsOpen(false)
    if (focusSearch) requestAnimationFrame(() => {
      queryInputRef.current?.focus()
      queryInputRef.current?.setSelectionRange(nextQuery.length, nextQuery.length)
    })
  }, [])

  const handleApplyQuickFilter = useCallback((filter: QuickFilter) => {
    replaceQuery(upsertQueryToken(query, filter))
  }, [query, replaceQuery])

  const handleClearQuickFilter = useCallback((key: string) => {
    replaceQuery(removeQueryTokens(query, getQuickFilterMatcher(key)))
  }, [query, replaceQuery])

  const handleClearRepoFilters = useCallback(() => {
    const nextQuery = stripRepoQualifiers(query)
    setQuery(nextQuery)
    setQueryCursor(nextQuery.length)
    setSelectedProjectIds(null)
    setSuggestionsOpen(false)
    queryInputRef.current?.focus()
  }, [query])

  const handleRepoSelectionChange = useCallback((nextIds: ReadonlySet<string>) => {
    setSelectedProjectIds(nextIds.size === projects.length ? null : new Set(nextIds))
    if (repoFilters.length > 0) {
      const nextQuery = stripRepoQualifiers(query)
      setQuery(nextQuery)
      setQueryCursor(nextQuery.length)
      setSuggestionsOpen(false)
    }
  }, [projects.length, query, repoFilters.length])

  const handleSelectAllRepos = useCallback(() => {
    setSelectedProjectIds(null)
    if (repoFilters.length > 0) {
      const nextQuery = stripRepoQualifiers(query)
      setQuery(nextQuery)
      setQueryCursor(nextQuery.length)
      setSuggestionsOpen(false)
    }
  }, [query, repoFilters.length])

  const counts = useMemo(() => rows.reduce((acc, row) => {
    row.item.type === 'pr' ? acc.prs += 1 : acc.issues += 1
    return acc
  }, { prs: 0, issues: 0 }), [rows])
  const authorLogins = useMemo(() => Array.from(new Set(rows.map((row) => row.item.author).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [rows])
  const activeFilterPills = useMemo<TaskFilterPill[]>(() => {
    const pills: TaskFilterPill[] = []
    if (parsedQuery.state && parsedQuery.state !== 'open') pills.push({ key: 'state', label: t('filterPill.status'), value: formatState(parsedQuery.state, t), clear: () => handleClearQuickFilter('state') })
    if (parsedQuery.draft) pills.push({ key: 'draft', label: t('filterPill.status'), value: t('status.draft'), clear: () => handleClearQuickFilter('draft') })
    if (parsedQuery.scope === 'pr') pills.push({ key: 'scope', label: t('filterPill.type'), value: t('type.prShort'), clear: () => handleClearQuickFilter('scope') })
    else if (parsedQuery.scope === 'issue') pills.push({ key: 'scope', label: t('filterPill.type'), value: t('type.issue'), clear: () => handleClearQuickFilter('scope') })
    if (parsedQuery.author) pills.push({ key: 'author', label: t('filterPill.author'), value: parsedQuery.author, clear: () => handleClearQuickFilter('author') })
    if (parsedQuery.assignee) pills.push({ key: 'assignee', label: t('filterPill.assignee'), value: parsedQuery.assignee, clear: () => handleClearQuickFilter('assignee') })
    if (parsedQuery.reviewRequested) pills.push({ key: 'reviewer', label: t('filterPill.reviewer'), value: parsedQuery.reviewRequested, clear: () => handleClearQuickFilter('reviewer') })
    if (parsedQuery.reviewedBy) pills.push({ key: 'reviewer', label: t('filterPill.reviewedBy'), value: parsedQuery.reviewedBy, clear: () => handleClearQuickFilter('reviewer') })
    if (parsedQuery.labels.length > 0) pills.push({ key: 'label', label: t('filterPill.label'), value: parsedQuery.labels.length === 1 ? parsedQuery.labels[0] : t('filterPill.labels', { count: parsedQuery.labels.length }), clear: () => handleClearQuickFilter('label') })
    return pills
  }, [handleClearQuickFilter, parsedQuery, t])

  return {
    projects, rows, query, activePresetId, countLoading, counts, activeFilterPills,
    repoFilters, errorCount, loading, perRepoLimit, filtersOpen, authorLogins,
    effectiveSelectedProjectIds, showSuggestions, filterSuggestions,
    highlightedSuggestion, queryInputRef, filtersRef, setQuery, setQueryCursor,
    setSuggestionsOpen, setFiltersOpen, setHighlightedSuggestion,
    handleRepoSelectionChange, handleSelectAllRepos, handleApplyQuickFilter,
    replaceQuery, handleQueryChange, handleQueryKeyDown, handleClearQuery,
    handleApplySuggestion, handleClearRepoFilters, fetchTasks, handleOpenRow,
    handleOpenGitHub, handleLoadMore, totalTaskCount,
    activeFilterCount: activeFilterPills.length,
    tableWrapClass: ['pr-table-wrap', loading && rows.length > 0 ? 'pr-table-wrap--refreshing' : null].filter(Boolean).join(' '),
    canLoadMoreTasks: totalTaskCount !== null && rows.length < totalTaskCount && perRepoLimit < MAX_PER_REPO_LIMIT,
    taskCountLabel: totalTaskCount === null ? t('taskCount', { count: rows.length }) : t('taskCountOfTotal', { count: rows.length, total: totalTaskCount }),
  }
}
