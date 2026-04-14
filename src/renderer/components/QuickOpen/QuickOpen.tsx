import { useReducer, useCallback, useRef, useEffect, useMemo, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { FileIcon } from '@react-symbols/icons/utils'
import { useUIStore } from '@/store/ui'
import { useProjectsStore } from '@/store/projects'
import * as ipc from '@/lib/ipc'
import { IconSearch } from '@/components/shared/icons'

const MAX_RESULTS = 50

// ─── State ────────────────────────────────────────────────────────────────────

interface QuickOpenState {
  filter: string
  highlightedIndex: number
  files: string[]
}

type QuickOpenAction =
  | { type: 'SET_FILTER'; filter: string }
  | { type: 'SET_HIGHLIGHTED'; index: number }
  | { type: 'HIGHLIGHT_NEXT'; max: number }
  | { type: 'HIGHLIGHT_PREV' }
  | { type: 'SET_FILES'; files: string[] }
  | { type: 'RESET' }

function reducer(state: QuickOpenState, action: QuickOpenAction): QuickOpenState {
  switch (action.type) {
    case 'SET_FILTER':
      return { ...state, filter: action.filter, highlightedIndex: 0 }
    case 'SET_HIGHLIGHTED':
      return { ...state, highlightedIndex: action.index }
    case 'HIGHLIGHT_NEXT':
      return { ...state, highlightedIndex: Math.min(state.highlightedIndex + 1, action.max) }
    case 'HIGHLIGHT_PREV':
      return { ...state, highlightedIndex: Math.max(state.highlightedIndex - 1, 0) }
    case 'SET_FILES':
      return { ...state, files: action.files }
    case 'RESET':
      return { filter: '', highlightedIndex: 0, files: state.files }
    default: {
      const _exhaustive: never = action
      return state
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function basename(filePath: string): string {
  const idx = filePath.lastIndexOf('/')
  return idx === -1 ? filePath : filePath.slice(idx + 1)
}

function dirname(filePath: string): string {
  const idx = filePath.lastIndexOf('/')
  return idx === -1 ? '' : filePath.slice(0, idx)
}

function highlightMatch(text: string, filter: string): ReactNode {
  if (!filter) return <>{text}</>
  const idx = text.toLowerCase().indexOf(filter.toLowerCase())
  if (idx === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <span className="quick-open-match">{text.slice(idx, idx + filter.length)}</span>
      {text.slice(idx + filter.length)}
    </>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function QuickOpen() {
  const { t } = useTranslation('right')
  const isOpen = useUIStore((s) => s.quickOpenOpen)
  const closeQuickOpen = useUIStore((s) => s.closeQuickOpen)
  const openFilePaths = useUIStore((s) => s.openFilePaths)

  const [state, dispatch] = useReducer(reducer, {
    filter: '',
    highlightedIndex: 0,
    files: [],
  })

  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])

  // Resolve worktree path from stores
  const selectedProjectId = useUIStore((s) => s.selectedProjectId)
  const selectedWorktreeId = useUIStore((s) => s.selectedWorktreeId)
  const project = useProjectsStore((s) => s.projects.find((p) => p.id === selectedProjectId))
  const worktree = project?.worktrees.find((w) => w.id === selectedWorktreeId)
  const worktreePath = worktree?.path ?? null

  // Fetch tracked files when overlay opens (or worktree changes while open).
  // Uses a cancelled flag to discard stale responses from a previous worktree.
  useEffect(() => {
    if (!isOpen || !worktreePath) return
    let cancelled = false
    ipc.git.getTrackedFiles(worktreePath)
      .then((files: string[]) => {
        if (!cancelled) dispatch({ type: 'SET_FILES', files })
      })
      .catch((error) => {
        if (cancelled) return
        console.warn('Failed to fetch tracked files for Quick Open', { worktreePath, error })
        dispatch({ type: 'SET_FILES', files: [] })
      })
    return () => { cancelled = true }
  }, [isOpen, worktreePath])

  // Reset state when closed
  useEffect(() => {
    if (!isOpen) dispatch({ type: 'RESET' })
  }, [isOpen])

  // Focus input when opened
  useEffect(() => {
    if (isOpen) requestAnimationFrame(() => inputRef.current?.focus())
  }, [isOpen])

  // Escape to close
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        closeQuickOpen()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen, closeQuickOpen])

  // Build open files list (relative paths from openFilePaths)
  const recentRelativePaths = useMemo(() => {
    if (!worktreePath) return []
    const prefix = worktreePath + '/'
    return openFilePaths
      .filter((p) => p.startsWith(prefix))
      .map((p) => p.slice(prefix.length))
      .reverse() // most recent first
  }, [openFilePaths, worktreePath])

  // Filter files
  const { displayItems, isFiltered } = useMemo(() => {
    const query = state.filter.trim().toLowerCase()
    if (!query) {
      // Show open files when no filter
      const recentSet = new Set(recentRelativePaths)
      const recent = recentRelativePaths.slice(0, 10)
      const rest = state.files.filter((f) => !recentSet.has(f)).slice(0, MAX_RESULTS - recent.length)
      return {
        displayItems: [
          ...recent.map((f) => ({ path: f, section: 'open' as const })),
          ...rest.map((f) => ({ path: f, section: 'files' as const })),
        ],
        isFiltered: false,
      }
    }
    const filtered = state.files
      .filter((f) => f.toLowerCase().includes(query))
      .slice(0, MAX_RESULTS)
      .map((f) => ({ path: f, section: 'files' as const }))
    return { displayItems: filtered, isFiltered: true }
  }, [state.filter, state.files, recentRelativePaths])

  // Scroll highlighted item into view
  useEffect(() => {
    itemRefs.current[state.highlightedIndex]?.scrollIntoView({ block: 'nearest' })
  }, [state.highlightedIndex])

  const selectFile = useCallback((relativePath: string) => {
    if (!worktreePath) return
    useUIStore.getState().openFile(`${worktreePath}/${relativePath}`)
    closeQuickOpen()
  }, [worktreePath, closeQuickOpen])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (displayItems.length === 0) return
    const maxIndex = displayItems.length - 1
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        dispatch({ type: 'HIGHLIGHT_NEXT', max: maxIndex })
        break
      case 'ArrowUp':
        e.preventDefault()
        dispatch({ type: 'HIGHLIGHT_PREV' })
        break
      case 'Enter':
        e.preventDefault()
        if (displayItems[state.highlightedIndex]) {
          selectFile(displayItems[state.highlightedIndex].path)
        }
        break
    }
  }, [displayItems, state.highlightedIndex, selectFile])

  if (!isOpen) return null

  // Trim stale refs so scrollIntoView never targets an unmounted element
  itemRefs.current.length = displayItems.length

  // Determine section headers
  let lastSection = ''

  const activeDescendantId = displayItems[state.highlightedIndex]
    ? `quick-open-item-${state.highlightedIndex}`
    : undefined

  return createPortal(
    <div className="quick-open-overlay" onClick={closeQuickOpen} role="dialog" aria-modal="true" aria-label={t('quickOpen')}>
      <div className="quick-open-panel" onClick={(e) => e.stopPropagation()}>
        <div className="quick-open-search">
          <IconSearch size={16} className="quick-open-search-icon" />
          <input
            ref={inputRef}
            className="quick-open-input"
            type="text"
            value={state.filter}
            onChange={(e) => dispatch({ type: 'SET_FILTER', filter: e.target.value })}
            onKeyDown={handleKeyDown}
            placeholder={t('quickOpenPlaceholder')}
            spellCheck={false}
            role="combobox"
            aria-expanded="true"
            aria-controls="quick-open-listbox"
            aria-activedescendant={activeDescendantId}
            aria-autocomplete="list"
          />
        </div>

        <div className="quick-open-list" ref={listRef} id="quick-open-listbox" role="listbox" aria-label={t('quickOpen')}>
          {displayItems.length === 0 ? (
            <div className="quick-open-empty">{t('quickOpenNoResults')}</div>
          ) : (
            displayItems.map((item, i) => {
              const showHeader = !isFiltered && item.section !== lastSection
              lastSection = item.section
              const name = basename(item.path)
              const dir = dirname(item.path)
              const isHighlighted = i === state.highlightedIndex

              return (
                <div key={item.path}>
                  {showHeader && (
                    <div className="quick-open-section-header">
                      {item.section === 'open' ? t('quickOpenOpen') : t('filesTab')}
                    </div>
                  )}
                  <div
                    id={`quick-open-item-${i}`}
                    ref={(el) => { itemRefs.current[i] = el }}
                    className={`quick-open-item${isHighlighted ? ' quick-open-item--highlighted' : ''}`}
                    role="option"
                    aria-selected={isHighlighted}
                    onMouseEnter={() => dispatch({ type: 'SET_HIGHLIGHTED', index: i })}
                    onMouseDown={(e) => { e.preventDefault(); selectFile(item.path) }}
                  >
                    <span className="quick-open-item-icon">
                      <FileIcon fileName={name} autoAssign width={18} height={18} />
                    </span>
                    <div className="quick-open-item-text">
                      <span className="quick-open-item-name">
                        {highlightMatch(name, state.filter)}
                      </span>
                      {dir && (
                        <span className="quick-open-item-dir">
                          {highlightMatch(dir, state.filter)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>

        <div className="quick-open-footer">
          <span>↑↓ navigate</span>
          <span className="quick-open-footer-dot">·</span>
          <span>↵ open</span>
          <span className="quick-open-footer-dot">·</span>
          <span>esc close</span>
        </div>
      </div>
    </div>,
    document.body
  )
}
