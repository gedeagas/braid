import { useRef, useEffect, useCallback, useReducer } from 'react'
import { useTranslation } from 'react-i18next'
import type { SearchAddon } from '@xterm/addon-search'

interface Props {
  searchAddon: SearchAddon
  onClose: () => void
}

interface State {
  query: string
  resultIndex: number
  resultCount: number
}

type Action =
  | { type: 'SET_QUERY'; query: string }
  | { type: 'SET_RESULTS'; resultIndex: number; resultCount: number }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SET_QUERY': return { ...state, query: action.query }
    case 'SET_RESULTS': return { ...state, resultIndex: action.resultIndex, resultCount: action.resultCount }
    default: return state
  }
}

const SEARCH_DECORATIONS = {
  matchBackground: '#515C6A',
  matchBorder: 'transparent',
  matchOverviewRuler: '#515C6A',
  activeMatchBackground: '#EDB04C',
  activeMatchBorder: 'transparent',
  activeMatchColorOverviewRuler: '#EDB04C',
}

export function TerminalSearch({ searchAddon, onClose }: Props) {
  const { t } = useTranslation('right')
  const inputRef = useRef<HTMLInputElement>(null)
  const [state, dispatch] = useReducer(reducer, { query: '', resultIndex: -1, resultCount: 0 })

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  // Subscribe to search result changes for "N of M" counter
  useEffect(() => {
    const disposable = searchAddon.onDidChangeResults((e) => {
      dispatch({ type: 'SET_RESULTS', resultIndex: e.resultIndex, resultCount: e.resultCount })
    })
    return () => disposable.dispose()
  }, [searchAddon])

  const findNext = useCallback(() => {
    if (!state.query) return
    searchAddon.findNext(state.query, { regex: false, caseSensitive: false, incremental: true, decorations: SEARCH_DECORATIONS })
  }, [searchAddon, state.query])

  const findPrevious = useCallback(() => {
    if (!state.query) return
    searchAddon.findPrevious(state.query, { regex: false, caseSensitive: false, decorations: SEARCH_DECORATIONS })
  }, [searchAddon, state.query])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value
    dispatch({ type: 'SET_QUERY', query: q })
    if (q) {
      searchAddon.findNext(q, { regex: false, caseSensitive: false, incremental: true, decorations: SEARCH_DECORATIONS })
    } else {
      searchAddon.clearDecorations()
      dispatch({ type: 'SET_RESULTS', resultIndex: -1, resultCount: 0 })
    }
  }, [searchAddon])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      searchAddon.clearDecorations()
      onClose()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) findPrevious()
      else findNext()
    }
  }, [onClose, searchAddon, findNext, findPrevious])

  const matchLabel = state.query && state.resultCount > 0 && state.resultIndex >= 0
    ? t('terminalSearchMatchOf', { current: state.resultIndex + 1, total: state.resultCount })
    : state.query && state.resultCount === 0
      ? t('terminalSearchNoResults')
      : null

  return (
    <div className="terminal-search-bar">
      <input
        ref={inputRef}
        className="terminal-search-input"
        type="text"
        value={state.query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={t('terminalSearchPlaceholder')}
        spellCheck={false}
      />
      {matchLabel && <span className="terminal-search-count">{matchLabel}</span>}
      <button className="terminal-search-btn" onClick={findPrevious} title={t('terminalSearchPrevious')}>
        &#x25B2;
      </button>
      <button className="terminal-search-btn" onClick={findNext} title={t('terminalSearchNext')}>
        &#x25BC;
      </button>
      <button className="terminal-search-btn" onClick={() => { searchAddon.clearDecorations(); onClose() }} title={t('terminalSearchClose')}>
        &#x2715;
      </button>
    </div>
  )
}
