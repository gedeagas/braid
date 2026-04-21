import { useEffect, useReducer, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { search as searchIpc } from '@/lib/ipc'
import { EmptyState, Spinner } from '@/components/ui'
import type {
  SearchFileResult,
  SearchMatch,
  SearchOptions,
  SearchResult,
} from '../../../../shared/search'
import { DEFAULT_MAX_RESULTS } from '../../../../shared/search'
import { SearchInput } from './SearchInput'
import { SearchResults } from './SearchResults'

interface Props {
  worktreePath: string
}

type Status = 'idle' | 'searching' | 'done' | 'error' | 'replacing'

interface State {
  query: string
  replacement: string
  showReplace: boolean
  includeGlobs: string
  excludeGlobs: string
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
  result: SearchResult | null
  status: Status
  collapsed: Set<string>
}

type Action =
  | { type: 'setQuery'; value: string }
  | { type: 'setReplacement'; value: string }
  | { type: 'toggleShowReplace' }
  | { type: 'setInclude'; value: string }
  | { type: 'setExclude'; value: string }
  | { type: 'toggleOption'; key: 'caseSensitive' | 'wholeWord' | 'regex' }
  | { type: 'searchStart' }
  | { type: 'searchDone'; result: SearchResult }
  | { type: 'replaceStart' }
  | { type: 'replaceDone' }
  | { type: 'toggleCollapsed'; path: string }
  | { type: 'clearResults' }
  | { type: 'reset' }

const initial: State = {
  query: '',
  replacement: '',
  showReplace: false,
  includeGlobs: '',
  excludeGlobs: '',
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  result: null,
  status: 'idle',
  collapsed: new Set(),
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'setQuery':
      return { ...state, query: action.value }
    case 'setReplacement':
      return { ...state, replacement: action.value }
    case 'toggleShowReplace':
      return { ...state, showReplace: !state.showReplace }
    case 'setInclude':
      return { ...state, includeGlobs: action.value }
    case 'setExclude':
      return { ...state, excludeGlobs: action.value }
    case 'toggleOption':
      return { ...state, [action.key]: !state[action.key] }
    case 'searchStart':
      return { ...state, status: 'searching' }
    case 'searchDone':
      return {
        ...state,
        result: action.result,
        status: action.result.error ? 'error' : 'done',
        collapsed: new Set(),
      }
    case 'replaceStart':
      return { ...state, status: 'replacing' }
    case 'replaceDone':
      return { ...state, status: 'done' }
    case 'toggleCollapsed': {
      const next = new Set(state.collapsed)
      if (next.has(action.path)) next.delete(action.path)
      else next.add(action.path)
      return { ...state, collapsed: next }
    }
    case 'clearResults':
      // Query was emptied — drop stale results but preserve user's filters,
      // globs, modifier toggles, and replace state so typing again picks up
      // where they left off.
      return { ...state, result: null, status: 'idle', collapsed: new Set() }
    case 'reset':
      return { ...initial }
    default:
      return state
  }
}

function splitGlobs(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function SearchView({ worktreePath }: Props) {
  const { t } = useTranslation('right')
  const [state, dispatch] = useReducer(reducer, initial)
  const requestIdRef = useRef(0)

  // Reset when worktree changes
  useEffect(() => {
    dispatch({ type: 'reset' })
  }, [worktreePath])

  // Debounced search
  useEffect(() => {
    if (state.query.length < 2) {
      // User cleared (or nearly cleared) the input — invalidate any in-flight
      // search and drop stale results so the panel returns to the idle state.
      if (state.result || state.status !== 'idle') {
        requestIdRef.current++
        dispatch({ type: 'clearResults' })
      }
      return
    }
    const id = ++requestIdRef.current
    dispatch({ type: 'searchStart' })
    const handle = setTimeout(async () => {
      const options: SearchOptions = {
        caseSensitive: state.caseSensitive,
        wholeWord: state.wholeWord,
        regex: state.regex,
        includeGlobs: splitGlobs(state.includeGlobs),
        excludeGlobs: splitGlobs(state.excludeGlobs),
        maxResults: DEFAULT_MAX_RESULTS,
      }
      try {
        const result = await searchIpc.content(worktreePath, state.query, options)
        if (id !== requestIdRef.current) return
        dispatch({ type: 'searchDone', result })
      } catch (err) {
        if (id !== requestIdRef.current) return
        dispatch({
          type: 'searchDone',
          result: {
            files: [],
            totalMatches: 0,
            truncated: false,
            elapsedMs: 0,
            error: {
              code: 'SPAWN_FAILED',
              message: err instanceof Error ? err.message : String(err),
            },
          },
        })
      }
    }, 250)
    return () => clearTimeout(handle)
  }, [
    worktreePath,
    state.query,
    state.caseSensitive,
    state.wholeWord,
    state.regex,
    state.includeGlobs,
    state.excludeGlobs,
  ])

  const handleReplaceAll = async () => {
    if (!state.result || state.result.files.length === 0) return
    const fileCount = state.result.files.length
    const confirmed = window.confirm(
      t('searchReplaceConfirm', { count: state.result.totalMatches, files: fileCount }),
    )
    if (!confirmed) return
    dispatch({ type: 'replaceStart' })
    await searchIpc.replace(worktreePath, state.result.files, state.replacement)
    dispatch({ type: 'replaceDone' })
    // Re-run search to refresh results
    requestIdRef.current++
    const options: SearchOptions = {
      caseSensitive: state.caseSensitive,
      wholeWord: state.wholeWord,
      regex: state.regex,
      includeGlobs: splitGlobs(state.includeGlobs),
      excludeGlobs: splitGlobs(state.excludeGlobs),
      maxResults: DEFAULT_MAX_RESULTS,
    }
    const fresh = await searchIpc.content(worktreePath, state.query, options)
    dispatch({ type: 'searchDone', result: fresh })
  }

  const handleReplaceOne = async (file: SearchFileResult, match: SearchMatch) => {
    await searchIpc.replaceOne(worktreePath, file.relativePath, [match], state.replacement)
    // Re-run search to refresh results
    requestIdRef.current++
    const options: SearchOptions = {
      caseSensitive: state.caseSensitive,
      wholeWord: state.wholeWord,
      regex: state.regex,
      includeGlobs: splitGlobs(state.includeGlobs),
      excludeGlobs: splitGlobs(state.excludeGlobs),
      maxResults: DEFAULT_MAX_RESULTS,
    }
    const fresh = await searchIpc.content(worktreePath, state.query, options)
    dispatch({ type: 'searchDone', result: fresh })
  }

  const error = state.result?.error
  const hasResults = state.result && state.result.files.length > 0
  const isEmpty = state.status === 'done' && !hasResults && !error

  return (
    <div className="search-view">
      <SearchInput
        query={state.query}
        replacement={state.replacement}
        showReplace={state.showReplace}
        includeGlobs={state.includeGlobs}
        excludeGlobs={state.excludeGlobs}
        caseSensitive={state.caseSensitive}
        wholeWord={state.wholeWord}
        regex={state.regex}
        canReplaceAll={!!hasResults && state.status !== 'replacing'}
        onQueryChange={(v) => dispatch({ type: 'setQuery', value: v })}
        onReplacementChange={(v) => dispatch({ type: 'setReplacement', value: v })}
        onToggleReplace={() => dispatch({ type: 'toggleShowReplace' })}
        onIncludeChange={(v) => dispatch({ type: 'setInclude', value: v })}
        onExcludeChange={(v) => dispatch({ type: 'setExclude', value: v })}
        onToggleOption={(key) => dispatch({ type: 'toggleOption', key })}
        onReplaceAll={handleReplaceAll}
      />

      <div className="search-view-body">
        {state.status === 'searching' && (
          <div className="search-status-row">
            <Spinner size="sm" />
            <span>{t('searchSearching')}</span>
          </div>
        )}

        {error && (
          <div className="search-error">
            {error.code === 'INVALID_REGEX' && t('searchErrorInvalidRegex')}
            {error.code === 'INVALID_GLOB' && t('searchErrorInvalidGlob')}
            {error.code === 'RG_MISSING' && t('searchErrorRgMissing')}
            {error.code === 'SPAWN_FAILED' && t('searchErrorGeneric')}
            {error.message && <div className="search-error-detail">{error.message}</div>}
          </div>
        )}

        {state.result?.truncated && (
          <div className="search-truncated-notice">
            {t('searchTruncated', { count: state.result.totalMatches })}
          </div>
        )}

        {isEmpty && <EmptyState title={t('searchNoResults')} />}

        {state.status === 'idle' && !state.query && (
          <EmptyState title={t('searchTab')} hint={t('searchTabTooltip')} />
        )}

        {hasResults && state.result && (
          <SearchResults
            files={state.result.files}
            collapsed={state.collapsed}
            showReplace={state.showReplace}
            worktreePath={worktreePath}
            onToggleCollapsed={(path) => dispatch({ type: 'toggleCollapsed', path })}
            onReplaceOne={handleReplaceOne}
          />
        )}
      </div>
    </div>
  )
}
