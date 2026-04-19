import { useReducer, useCallback, useRef, useEffect, useMemo, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/store/ui'
import { useSessionsStore } from '@/store/sessions'
import { useProjectsStore } from '@/store/projects'
import { SHORTCUTS, SHORTCUT_CATEGORIES } from '@/lib/shortcuts'
import type { ShortcutCategory } from '@/lib/shortcuts'
import { navigateTab, getUnifiedTabs, activateTab } from '@/lib/tabNavigation'
import { ShortcutBadge } from '@/components/Shortcuts/ShortcutBadge'
import { IconSearch } from '@/components/shared/icons'
import i18n from '@/lib/i18n'

// ─── Types ───────────────────────────────────────────────────────────────────

interface CommandDef {
  id: string
  category: ShortcutCategory
  execute: () => void
}

// ─── State ───────────────────────────────────────────────────────────────────

interface PaletteState {
  filter: string
  highlightedIndex: number
}

type PaletteAction =
  | { type: 'SET_FILTER'; filter: string }
  | { type: 'SET_HIGHLIGHTED'; index: number }
  | { type: 'HIGHLIGHT_NEXT'; max: number }
  | { type: 'HIGHLIGHT_PREV' }
  | { type: 'RESET' }

function reducer(state: PaletteState, action: PaletteAction): PaletteState {
  switch (action.type) {
    case 'SET_FILTER':
      return { ...state, filter: action.filter, highlightedIndex: 0 }
    case 'SET_HIGHLIGHTED':
      return { ...state, highlightedIndex: action.index }
    case 'HIGHLIGHT_NEXT':
      return { ...state, highlightedIndex: Math.min(state.highlightedIndex + 1, action.max) }
    case 'HIGHLIGHT_PREV':
      return { ...state, highlightedIndex: Math.max(state.highlightedIndex - 1, 0) }
    case 'RESET':
      return { filter: '', highlightedIndex: 0 }
    default: {
      const _exhaustive: never = action
      return state
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const shortcutMap = new Map(SHORTCUTS.map((s) => [s.id, s.symbols]))

function highlightMatch(text: string, filter: string): ReactNode {
  if (!filter) return <>{text}</>
  const idx = text.toLowerCase().indexOf(filter.toLowerCase())
  if (idx === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <span className="cmd-palette-match">{text.slice(idx, idx + filter.length)}</span>
      {text.slice(idx + filter.length)}
    </>
  )
}

function scoreCommand(label: string, query: string): number {
  const q = query.toLowerCase()
  const l = label.toLowerCase()
  if (l === q) return 110
  if (l.startsWith(q)) return 100
  if (l.includes(q)) return 60
  return -1
}

// ─── Component ───────────────────────────────────────────────────────────────

export function CommandPalette() {
  const { t } = useTranslation('shortcuts')
  const isOpen = useUIStore((s) => s.commandPaletteOpen)
  const close = useUIStore((s) => s.closeCommandPalette)

  const [state, dispatch] = useReducer(reducer, { filter: '', highlightedIndex: 0 })

  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])

  // Build command registry
  const commands = useMemo<CommandDef[]>(() => [
    // General
    { id: 'openSettings', category: 'general', execute: () => useUIStore.getState().openSettings() },
    { id: 'showShortcuts', category: 'general', execute: () => useUIStore.getState().openShortcuts() },
    { id: 'toggleMissionControl', category: 'general', execute: () => useUIStore.getState().toggleMissionControl() },

    // View
    { id: 'toggleSidebar', category: 'view', execute: () => useUIStore.getState().toggleSidebar() },
    { id: 'toggleRightPanel', category: 'view', execute: () => useUIStore.getState().toggleRightPanel() },
    {
      id: 'toggleTerminal', category: 'view', execute: () => {
        const { bottomTerminalEnabled, setBottomTerminalEnabled } = useUIStore.getState()
        setBottomTerminalEnabled(!bottomTerminalEnabled)
      },
    },
    {
      id: 'zoomIn', category: 'view', execute: () => {
        const { uiZoom, setUIZoom } = useUIStore.getState()
        setUIZoom(uiZoom + 0.1)
      },
    },
    {
      id: 'zoomOut', category: 'view', execute: () => {
        const { uiZoom, setUIZoom } = useUIStore.getState()
        setUIZoom(uiZoom - 0.1)
      },
    },
    { id: 'zoomReset', category: 'view', execute: () => useUIStore.getState().setUIZoom(1.0) },

    // Navigation
    {
      id: 'newChatTab', category: 'navigation', execute: () => {
        const { selectedWorktreeId, selectedProjectId, setActiveCenterView } = useUIStore.getState()
        if (!selectedWorktreeId || !selectedProjectId) return
        const project = useProjectsStore.getState().projects.find((p) => p.id === selectedProjectId)
        const worktree = project?.worktrees.find((w) => w.id === selectedWorktreeId)
        if (!worktree) return
        const sessionId = useSessionsStore.getState().createSession(selectedWorktreeId, worktree.path)
        setActiveCenterView({ type: 'session', sessionId })
      },
    },
    {
      id: 'closeTab', category: 'navigation', execute: () => {
        const ui = useUIStore.getState()
        const wtId = ui.selectedWorktreeId ?? ''
        const acv = ui.activeCenterViewByWorktree[wtId] ?? null
        let activeKey: string | null = null
        if (acv?.type === 'session') activeKey = `s:${acv.sessionId}`
        else if (acv?.type === 'file') activeKey = `f:${acv.path}`
        else if (acv?.type === 'changes') activeKey = 'changes'
        if (!activeKey) return

        const tabs = getUnifiedTabs()
        const closingIndex = tabs.indexOf(activeKey)
        const adjacentKey = closingIndex >= 0
          ? tabs[closingIndex + 1] ?? tabs[closingIndex - 1] ?? null
          : null

        if (activeKey.startsWith('s:')) {
          const sid = activeKey.slice(2)
          const session = useSessionsStore.getState().sessions[sid]
          if (session && session.status !== 'idle' && session.status !== 'inactive') {
            const title = i18n.t('closeActiveSessionTitle', { ns: 'center' })
            const msg = i18n.t('closeActiveSessionMessage', { ns: 'center', status: session.status })
            if (!window.confirm(`${title}\n\n${msg}`)) return
          }
          useSessionsStore.getState().closeSession(sid)
        } else if (activeKey.startsWith('f:')) {
          ui.closeFile(activeKey.slice(2))
        } else if (activeKey === 'changes') {
          ui.closeChanges()
        }

        if (adjacentKey) activateTab(adjacentKey)
      },
    },
    { id: 'previousTab', category: 'navigation', execute: () => navigateTab(-1) },
    { id: 'nextTab', category: 'navigation', execute: () => navigateTab(1) },
    { id: 'quickOpen', category: 'navigation', execute: () => useUIStore.getState().openQuickOpen() },
    { id: 'focusChat', category: 'navigation', execute: () => window.dispatchEvent(new CustomEvent('braid:focusChat')) },
    {
      id: 'saveFile', category: 'navigation', execute: () => {
        const wtId = useUIStore.getState().selectedWorktreeId ?? ''
        const acv = useUIStore.getState().activeCenterViewByWorktree[wtId] ?? null
        if (acv?.type === 'file') window.dispatchEvent(new CustomEvent('braid:saveFile'))
      },
    },
  ], [])

  // Filter and sort commands
  const { displayItems, isFiltered } = useMemo(() => {
    const query = state.filter.trim()
    if (!query) return { displayItems: commands, isFiltered: false }

    const scored = commands
      .map((cmd) => ({ cmd, score: scoreCommand(t(cmd.id), query) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)

    return { displayItems: scored.map((e) => e.cmd), isFiltered: true }
  }, [state.filter, commands, t])

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
        close()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen, close])

  // Scroll highlighted item into view
  useEffect(() => {
    itemRefs.current[state.highlightedIndex]?.scrollIntoView({ block: 'nearest' })
  }, [state.highlightedIndex])

  const executeCommand = useCallback((cmd: CommandDef) => {
    close()
    // Defer execution so the palette closes first
    requestAnimationFrame(() => cmd.execute())
  }, [close])

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
          executeCommand(displayItems[state.highlightedIndex])
        }
        break
    }
  }, [displayItems, state.highlightedIndex, executeCommand])

  if (!isOpen) return null

  // Trim stale refs
  itemRefs.current.length = displayItems.length

  // Track section headers
  let lastCategory = ''
  let flatIndex = -1

  const activeDescendantId = displayItems[state.highlightedIndex]
    ? `cmd-palette-item-${state.highlightedIndex}`
    : undefined

  return createPortal(
    <div className="cmd-palette-overlay" onClick={close} role="dialog" aria-modal="true" aria-label={t('commandPalette')}>
      <div className="cmd-palette-panel" onClick={(e) => e.stopPropagation()}>
        <div className="cmd-palette-search">
          <IconSearch size={16} className="cmd-palette-search-icon" />
          <input
            ref={inputRef}
            className="cmd-palette-input"
            type="text"
            value={state.filter}
            onChange={(e) => dispatch({ type: 'SET_FILTER', filter: e.target.value })}
            onKeyDown={handleKeyDown}
            placeholder={t('commandPaletteSearch')}
            spellCheck={false}
            role="combobox"
            aria-expanded="true"
            aria-controls="cmd-palette-listbox"
            aria-activedescendant={activeDescendantId}
            aria-autocomplete="list"
          />
        </div>

        <div className="cmd-palette-list" ref={listRef} id="cmd-palette-listbox" role="listbox" aria-label={t('commandPalette')}>
          {displayItems.length === 0 ? (
            <div className="cmd-palette-empty">{t('commandPaletteNoResults', { query: state.filter })}</div>
          ) : (
            displayItems.map((cmd) => {
              flatIndex++
              const i = flatIndex
              const showHeader = !isFiltered && cmd.category !== lastCategory
              if (!isFiltered) lastCategory = cmd.category
              const label = t(cmd.id)
              const symbols = shortcutMap.get(cmd.id)
              const isHighlighted = i === state.highlightedIndex

              return (
                <div key={cmd.id}>
                  {showHeader && (
                    <div className="cmd-palette-section-header">
                      {t(`categories.${cmd.category}`)}
                    </div>
                  )}
                  <div
                    id={`cmd-palette-item-${i}`}
                    ref={(el) => { itemRefs.current[i] = el }}
                    className={`cmd-palette-item${isHighlighted ? ' cmd-palette-item--highlighted' : ''}`}
                    role="option"
                    aria-selected={isHighlighted}
                    onMouseEnter={() => dispatch({ type: 'SET_HIGHLIGHTED', index: i })}
                    onMouseDown={(e) => { e.preventDefault(); executeCommand(cmd) }}
                  >
                    <span className="cmd-palette-item-label">
                      {highlightMatch(label, state.filter)}
                    </span>
                    {symbols && (
                      <span className="cmd-palette-item-shortcut">
                        <ShortcutBadge symbols={symbols} />
                      </span>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>

        <div className="cmd-palette-footer">
          <span>↑↓ navigate</span>
          <span className="cmd-palette-footer-dot">·</span>
          <span>↵ {t('commandPaletteRun')}</span>
          <span className="cmd-palette-footer-dot">·</span>
          <span>esc close</span>
        </div>
      </div>
    </div>,
    document.body
  )
}
