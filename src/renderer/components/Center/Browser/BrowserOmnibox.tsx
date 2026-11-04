import { memo, useCallback, useEffect, useReducer, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { IconGlobe, IconSearch } from '@/components/shared/icons'
import { displayUrl, resolveOmniboxInput, searchUrl } from '@/lib/browser/omnibox'
import { rankSuggestions } from '@/lib/browser/history'
import { getBrowserHistory } from '@/lib/browser/historyStore'
import { BROWSER_FOCUS_ADDRESS_EVENT } from '@/lib/browser/browserCommands'

interface Suggestion {
  kind: 'navigate' | 'search' | 'history'
  url: string
  label: string
  detail?: string
}

interface State {
  editing: boolean
  text: string
  suggestions: Suggestion[]
  highlighted: number
}

type Action =
  | { type: 'focus'; text: string }
  | { type: 'type'; text: string; suggestions: Suggestion[] }
  | { type: 'move'; delta: number }
  | { type: 'reset'; text: string }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'focus': return { editing: true, text: action.text, suggestions: [], highlighted: -1 }
    case 'type': return { ...state, editing: true, text: action.text, suggestions: action.suggestions, highlighted: -1 }
    case 'move': {
      const n = state.suggestions.length
      if (n === 0) return state
      const next = state.highlighted + action.delta
      return { ...state, highlighted: next < -1 ? n - 1 : next >= n ? -1 : next }
    }
    case 'reset': return { editing: false, text: action.text, suggestions: [], highlighted: -1 }
  }
}

function buildSuggestions(worktreeId: string, text: string, searchLabel: (q: string) => string): Suggestion[] {
  const query = text.trim()
  if (!query) return []
  const resolved = resolveOmniboxInput(query)
  const isSearch = !resolved || resolved === searchUrl(query.replace(/^\?/, '').trim())
  const first: Suggestion = isSearch
    ? { kind: 'search', url: resolved ?? searchUrl(query), label: searchLabel(query.replace(/^\?/, '').trim()) }
    : { kind: 'navigate', url: resolved, label: displayUrl(resolved) }
  const history = rankSuggestions(getBrowserHistory(worktreeId), query, Date.now(), 6)
    .filter((h) => h.url !== first.url)
    .map((h): Suggestion => ({ kind: 'history', url: h.url, label: h.title || displayUrl(h.url), detail: h.title ? displayUrl(h.url) : undefined }))
  return [first, ...history]
}

interface Props {
  tabId: string
  worktreeId: string
  url: string
  autoFocus: boolean
  onNavigate: (url: string) => void
  /** Return focus to the page (Escape / after navigating). */
  onDone: () => void
}

export const BrowserOmnibox = memo(function BrowserOmnibox({ tabId, worktreeId, url, autoFocus, onNavigate, onDone }: Props) {
  const { t } = useTranslation('center')
  const inputRef = useRef<HTMLInputElement>(null)
  const [state, dispatch] = useReducer(reducer, { editing: false, text: displayUrl(url), suggestions: [], highlighted: -1 })

  // Follow page navigations while the user isn't typing.
  useEffect(() => {
    if (!state.editing) dispatch({ type: 'reset', text: displayUrl(url) })
  }, [url, state.editing])

  const focusAndSelect = useCallback(() => {
    const input = inputRef.current
    if (!input) return
    input.focus()
    input.select()
  }, [])

  useEffect(() => {
    if (autoFocus) focusAndSelect()
  }, [autoFocus, focusAndSelect])

  useEffect(() => {
    const onFocusRequest = (e: Event) => {
      if ((e as CustomEvent<{ tabId: string }>).detail?.tabId === tabId) focusAndSelect()
    }
    window.addEventListener(BROWSER_FOCUS_ADDRESS_EVENT, onFocusRequest)
    return () => window.removeEventListener(BROWSER_FOCUS_ADDRESS_EVENT, onFocusRequest)
  }, [tabId, focusAndSelect])

  const searchLabel = useCallback((q: string) => t('browser.searchSuggestion', { query: q }), [t])

  const commit = useCallback((target: string | null) => {
    if (!target) return
    dispatch({ type: 'reset', text: displayUrl(target) })
    onNavigate(target)
    onDone()
  }, [onNavigate, onDone])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); dispatch({ type: 'move', delta: 1 }) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); dispatch({ type: 'move', delta: -1 }) }
    else if (e.key === 'Escape') {
      e.preventDefault()
      dispatch({ type: 'reset', text: displayUrl(url) })
      onDone()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const picked = state.highlighted >= 0 ? state.suggestions[state.highlighted]?.url : resolveOmniboxInput(state.text)
      commit(picked ?? null)
    }
  }, [state.highlighted, state.suggestions, state.text, url, commit, onDone])

  const open = state.editing && state.suggestions.length > 0

  return (
    <div className="browser-omnibox">
      <input
        ref={inputRef}
        className="browser-omnibox-input"
        value={state.text}
        placeholder={t('browser.addressPlaceholder')}
        spellCheck={false}
        autoComplete="off"
        aria-label={t('browser.addressPlaceholder')}
        aria-expanded={open}
        aria-autocomplete="list"
        onFocus={() => {
          // Show the full URL while editing; select after React swaps the value in.
          if (!state.editing) dispatch({ type: 'focus', text: url && url !== 'about:blank' ? url : '' })
          requestAnimationFrame(() => inputRef.current?.select())
        }}
        onBlur={() => dispatch({ type: 'reset', text: displayUrl(url) })}
        onChange={(e) => dispatch({ type: 'type', text: e.target.value, suggestions: buildSuggestions(worktreeId, e.target.value, searchLabel) })}
        onKeyDown={handleKeyDown}
      />
      {open && (
        <ul className="browser-omnibox-suggestions" role="listbox">
          {state.suggestions.map((s, i) => (
            <li
              key={`${s.kind}:${s.url}`}
              role="option"
              aria-selected={i === state.highlighted}
              className={`browser-omnibox-suggestion${i === state.highlighted ? ' browser-omnibox-suggestion--active' : ''}`}
              // mousedown (not click) so the input's blur doesn't close the list first
              onMouseDown={(e) => { e.preventDefault(); commit(s.url) }}
            >
              <span className="browser-omnibox-suggestion-icon">
                {s.kind === 'search' ? <IconSearch size={12} /> : <IconGlobe size={12} />}
              </span>
              <span className="browser-omnibox-suggestion-label">{s.label}</span>
              {s.detail && <span className="browser-omnibox-suggestion-detail">{s.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
})
