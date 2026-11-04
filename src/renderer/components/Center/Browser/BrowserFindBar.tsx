import { memo, useCallback, useEffect, useReducer, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { IconArrowDown, IconArrowUp, IconClose } from '@/components/shared/icons'
import { Button } from '@/components/ui'
import { BROWSER_FIND_EVENT, getBrowserWebview } from '@/lib/browser/browserCommands'
import type { WebviewFoundInPageEvent } from '@/lib/browser/webviewTypes'

interface State {
  text: string
  current: number
  total: number
}

type Action =
  | { type: 'text'; text: string }
  | { type: 'result'; current: number; total: number }

function reducer(state: State, action: Action): State {
  if (action.type === 'text') return { text: action.text, current: 0, total: 0 }
  return { ...state, current: action.current, total: action.total }
}

interface Props {
  tabId: string
  onClose: () => void
}

export const BrowserFindBar = memo(function BrowserFindBar({ tabId, onClose }: Props) {
  const { t } = useTranslation('center')
  const inputRef = useRef<HTMLInputElement>(null)
  const [state, dispatch] = useReducer(reducer, { text: '', current: 0, total: 0 })

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  // Re-focus when ⌘F is pressed again while the bar is already open.
  useEffect(() => {
    const onFind = (e: Event) => {
      if ((e as CustomEvent<{ tabId: string }>).detail?.tabId !== tabId) return
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    window.addEventListener(BROWSER_FIND_EVENT, onFind)
    return () => window.removeEventListener(BROWSER_FIND_EVENT, onFind)
  }, [tabId])

  useEffect(() => {
    const wv = getBrowserWebview(tabId)
    if (!wv) return
    const onFound = (e: Event) => {
      const { result } = e as WebviewFoundInPageEvent
      if (result.finalUpdate) dispatch({ type: 'result', current: result.activeMatchOrdinal, total: result.matches })
    }
    wv.addEventListener('found-in-page', onFound)
    return () => {
      wv.removeEventListener('found-in-page', onFound)
      try { wv.stopFindInPage('clearSelection') } catch { /* guest gone */ }
    }
  }, [tabId])

  const find = useCallback((text: string, forward: boolean, findNext: boolean) => {
    const wv = getBrowserWebview(tabId)
    if (!wv) return
    try {
      if (text) wv.findInPage(text, { forward, findNext })
      else wv.stopFindInPage('clearSelection')
    } catch { /* guest not attached */ }
  }, [tabId])

  const handleChange = useCallback((text: string) => {
    dispatch({ type: 'text', text })
    find(text, true, false)
  }, [find])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose() }
    else if (e.key === 'Enter') { e.preventDefault(); find(state.text, !e.shiftKey, true) }
  }, [find, onClose, state.text])

  const counter = !state.text ? '' : state.total === 0
    ? t('browser.findNoResults')
    : t('browser.findCount', { current: state.current, total: state.total })

  return (
    <div className="browser-find-bar" role="search">
      <input
        ref={inputRef}
        className="browser-find-input"
        value={state.text}
        placeholder={t('browser.findPlaceholder')}
        aria-label={t('browser.findPlaceholder')}
        spellCheck={false}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <span className="browser-find-count" aria-live="polite">{counter}</span>
      <Button size="icon" className="browser-icon-btn" aria-label={t('browser.findPrevious')} disabled={state.total === 0} onClick={() => find(state.text, false, true)}>
        <IconArrowUp size={12} />
      </Button>
      <Button size="icon" className="browser-icon-btn" aria-label={t('browser.findNext')} disabled={state.total === 0} onClick={() => find(state.text, true, true)}>
        <IconArrowDown size={12} />
      </Button>
      <Button size="icon" className="browser-icon-btn" aria-label={t('browser.findClose')} onClick={onClose}>
        <IconClose size={12} />
      </Button>
    </div>
  )
})
