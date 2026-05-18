import { useRef, useEffect, useCallback, useReducer } from 'react'
import type { SearchAddon } from '@xterm/addon-search'

interface Props {
  searchAddon: SearchAddon
  onClose: () => void
}

interface State {
  query: string
  matchCount: number
}

type Action =
  | { type: 'SET_QUERY'; query: string }
  | { type: 'SET_COUNT'; count: number }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SET_QUERY': return { ...state, query: action.query }
    case 'SET_COUNT': return { ...state, matchCount: action.count }
    default: return state
  }
}

export function TerminalSearch({ searchAddon, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [state, dispatch] = useReducer(reducer, { query: '', matchCount: -1 })

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const findNext = useCallback(() => {
    if (!state.query) return
    searchAddon.findNext(state.query, { regex: false, caseSensitive: false, incremental: true })
  }, [searchAddon, state.query])

  const findPrevious = useCallback(() => {
    if (!state.query) return
    searchAddon.findPrevious(state.query, { regex: false, caseSensitive: false })
  }, [searchAddon, state.query])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value
    dispatch({ type: 'SET_QUERY', query: q })
    if (q) {
      searchAddon.findNext(q, { regex: false, caseSensitive: false, incremental: true })
    } else {
      searchAddon.clearDecorations()
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

  return (
    <div className="terminal-search-bar">
      <input
        ref={inputRef}
        className="terminal-search-input"
        type="text"
        value={state.query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="Find..."
        spellCheck={false}
      />
      <button className="terminal-search-btn" onClick={findPrevious} title="Previous (Shift+Enter)">
        &#x25B2;
      </button>
      <button className="terminal-search-btn" onClick={findNext} title="Next (Enter)">
        &#x25BC;
      </button>
      <button className="terminal-search-btn" onClick={() => { searchAddon.clearDecorations(); onClose() }} title="Close (Esc)">
        &#x2715;
      </button>
    </div>
  )
}
