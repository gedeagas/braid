import { useRef, useReducer, useCallback, useEffect, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import * as ipc from '@/lib/ipc'
import { useDragScroll } from '@/hooks/useDragScroll'
import { useTabReorder } from '@/hooks/useTabReorder'
import { Tooltip } from '@/components/shared/Tooltip'
import { IconChevronDown, IconChevronRight, IconPlay, IconPlus, IconSettings } from '@/components/shared/icons'
import { SetupPanel } from './SetupPanel'
import { RunPanel } from './RunPanel'
import { TerminalTabRow } from './TerminalTabRow'
import {
  SETUP_TAB_ID, RUN_TAB_ID,
  terminalCache, nextTabId, createTerminal, activateWebgl, saveRightTerminalTabs,
  type TermTab, type RenameState,
} from './terminalCache'
import { useTerminalLifecycle } from './useTerminalLifecycle'
import { useTerminalFileDrop } from '@/hooks/useTerminalFileDrop'
import { useTerminalClipboardPaste } from '@/hooks/useTerminalClipboardPaste'
import { createTerminalCommandObserver } from '@/lib/terminalCommandRefresh'
import { replayIntoTerminal, isReplaying, POST_REPLAY_MODE_RESET } from '@/lib/replayGuard'
import '@xterm/xterm/css/xterm.css'

export { cleanupTerminals } from './terminalCache'

interface Props {
  worktreePath: string
  projectId: string
  projectPath: string
  hidden?: boolean
  collapsed?: boolean
  onToggleCollapse?: () => void
  /** When false, hide the Setup and Run fixed tabs. Default: true */
  showFixedTabs?: boolean
}

// ── Fixed tab button (Setup / Run) ──────────────────────────────────────────

export function FixedTabButton({ active, icon, label, onClick }: {
  active: boolean; icon: ReactNode; label: string; onClick: () => void
}) {
  const classes = [
    'terminal-tab',
    'terminal-tab--fixed',
    active ? 'terminal-tab--active' : '',
  ].filter(Boolean).join(' ')

  return (
    <button
      type="button"
      className={classes}
      onClick={onClick}
    >
      <span className="terminal-tab__prompt">{icon}</span>
      <span className="terminal-tab__label">{label}</span>
    </button>
  )
}

// ── Terminal UI state ────────────────────────────────────────────────────────

interface TermState {
  tabs: TermTab[]
  activeTabId: string | null
  renaming: RenameState | null
  hoveredTabId: string | null
}

type TermAction =
  | { type: 'SET_TABS'; tabs: TermTab[] }
  | { type: 'UPDATE_TABS'; fn: (prev: TermTab[]) => TermTab[] }
  | { type: 'SET_ACTIVE'; id: string | null }
  | { type: 'SET_RENAMING'; state: RenameState | null }
  | { type: 'SET_HOVERED'; id: string | null }

const termInitialState: TermState = { tabs: [], activeTabId: null, renaming: null, hoveredTabId: null }

function termReducer(state: TermState, action: TermAction): TermState {
  switch (action.type) {
    case 'SET_TABS': return { ...state, tabs: action.tabs }
    case 'UPDATE_TABS': return { ...state, tabs: action.fn(state.tabs) }
    case 'SET_ACTIVE': return { ...state, activeTabId: action.id }
    case 'SET_RENAMING': return { ...state, renaming: action.state }
    case 'SET_HOVERED': return { ...state, hoveredTabId: action.id }
    default: return state
  }
}

// ── Main component ──────────────────────────────────────────────────────────

export function TabbedTerminal({ worktreePath, projectId, projectPath, hidden, collapsed, onToggleCollapse, showFixedTabs = true }: Props) {
  const { t } = useTranslation('right')
  const [state, dispatch] = useReducer(termReducer, termInitialState)
  const { tabs, activeTabId, renaming, hoveredTabId } = state
  const isSetupActive = activeTabId === SETUP_TAB_ID
  const isRunActive = activeTabId === RUN_TAB_ID
  const isSpecialTab = isSetupActive || isRunActive
  const renameInputRef = useRef<HTMLInputElement>(null)
  const tabsRef = useRef<TermTab[]>([])
  const activeTabIdRef = useRef<string | null>(null)
  const containerRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const pendingAttach = useRef<Map<string, TermTab>>(new Map())
  const tabBarRef = useRef<HTMLDivElement>(null)
  // contentAreaRef removed - clipboard paste callback ref handles the content area
  const worktreePathRef = useRef(worktreePath)
  worktreePathRef.current = worktreePath
  const pendingCommandRef = useRef<string | null>(null)
  const { onMouseDown: tabBarMouseDown, isDragging: tabBarDragging, preventClickAfterDrag } = useDragScroll(tabBarRef)

  // File-drop onto active terminal tab
  const getFileDropTarget = useCallback(() => {
    const tab = tabsRef.current.find((t) => t.id === activeTabIdRef.current)
    if (!tab) return null
    return { ptyId: tab.ptyId, focus: () => tab.term.focus() }
  }, [])
  const fileDrop = useTerminalFileDrop(getFileDropTarget)
  const clipboardPasteRef = useTerminalClipboardPaste(getFileDropTarget)

  // Convert vertical wheel scroll to horizontal scroll on the tab bar
  const handleWheel = useCallback((e: React.WheelEvent) => {
    const el = tabBarRef.current
    if (!el) return
    if (el.scrollWidth <= el.clientWidth) return
    e.preventDefault()
    el.scrollLeft += e.deltaY || e.deltaX
  }, [])

  // ── Stable dispatch wrappers (passed to useTerminalLifecycle) ───────────
  const setTabs: React.Dispatch<React.SetStateAction<TermTab[]>> = useCallback((action) => {
    if (typeof action === 'function') dispatch({ type: 'UPDATE_TABS', fn: action })
    else dispatch({ type: 'SET_TABS', tabs: action })
  }, [])

  const setActiveTabId: React.Dispatch<React.SetStateAction<string | null>> = useCallback((action) => {
    const id = typeof action === 'function' ? action(activeTabIdRef.current) : action
    dispatch({ type: 'SET_ACTIVE', id })
  }, [])

  // ── Activate a fixed tab (Setup / Run) ──────────────────────────────────
  const activateFixedTab = useCallback((tabId: string) => {
    dispatch({ type: 'SET_ACTIVE', id: tabId })
    activeTabIdRef.current = tabId
    const cached = terminalCache.get(worktreePathRef.current)
    if (cached) cached.activeTabId = tabId
    if (collapsed && onToggleCollapse) onToggleCollapse()
  }, [collapsed, onToggleCollapse])

  // ── Tab reorder ─────────────────────────────────────────────────────────
  const reorderTabs = useCallback((fromIndex: number, toIndex: number) => {
    dispatch({ type: 'UPDATE_TABS', fn: (prev) => {
      const next = [...prev]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      tabsRef.current = next
      const cached = terminalCache.get(worktreePathRef.current)
      if (cached) cached.tabs = next
      saveRightTerminalTabs(worktreePathRef.current, next)
      return next
    }})
  }, [])

  const tabKeys = tabs.map((t) => t.id)
  const { dragKey, overKey, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd } = useTabReorder(tabKeys, reorderTabs)

  // ── Terminal operations ─────────────────────────────────────────────────
  const attachTerm = useCallback((tab: TermTab, el: HTMLDivElement) => {
    if (!tab.term.element) { tab.term.open(el); activateWebgl(tab.term) } else { el.appendChild(tab.term.element) }
    requestAnimationFrame(() => {
      try { tab.fitAddon.fit(); if (tab.ptyId) ipc.pty.resize(tab.ptyId, tab.term.cols, tab.term.rows) }
      catch { /* ignore */ }
    })
  }, [])

  const setupResizeObserver = useCallback((tab: TermTab, el: HTMLDivElement) => {
    tab.resizeObserver?.disconnect()
    let rafId: number | null = null
    const observer = new ResizeObserver(() => {
      if (activeTabIdRef.current === tab.id) {
        if (rafId !== null) return
        rafId = requestAnimationFrame(() => {
          rafId = null
          try {
            tab.fitAddon.fit()
            const { cols, rows } = tab.term
            for (const t of tabsRef.current) {
              if (t.ptyId) ipc.pty.resize(t.ptyId, cols, rows)
            }
          } catch { /* ignore */ }
        })
      }
    })
    observer.observe(el)
    tab.resizeObserver = observer
  }, [])

  const spawnTab = useCallback(async (tab: TermTab) => {
    // Attempt warm reattach to daemon session first
    try {
      const result = await ipc.pty.reattach(tab.id)
      if (result && result.snapshot) {
        tab.ptyId = result.sessionId
        const observer = createTerminalCommandObserver(worktreePathRef.current, { refreshWorktrees: true })
        tab.commandObserver = observer
        // Register for daemon-side scrollback persistence so this tab survives a
        // daemon death (cold app restart), matching big-terminal behavior.
        ipc.pty.registerBigTerminal(result.sessionId, tab.id)
        // Replay under guard to suppress xterm auto-replies (DA1, DECRQM, etc.)
        // leaking back into the reconnected shell as keystrokes.
        replayIntoTerminal(tab.id, tab.term, result.snapshot)
        replayIntoTerminal(tab.id, tab.term, '\r\n\x1b[2m[session reconnected]\x1b[0m\r\n')
        replayIntoTerminal(tab.id, tab.term, POST_REPLAY_MODE_RESET)
        tab.term.onData((data: string) => {
          if (isReplaying(tab.id)) return
          observer.accept(data)
          ipc.pty.write(result.sessionId, data)
        })
        requestAnimationFrame(() => {
          try { tab.fitAddon.fit(); ipc.pty.resize(result.sessionId, tab.term.cols, tab.term.rows) } catch { /* ignore */ }
        })
        return
      }
    } catch {
      // Reattach not available - fall through to scrollback restore + fresh spawn
    }

    // Fall back to scrollback file replay + fresh spawn (daemon session is gone)
    let hasScrollback = false
    try {
      const scrollback = await ipc.pty.readScrollback(tab.id)
      if (scrollback && scrollback.length > 0) {
        hasScrollback = true
        replayIntoTerminal(tab.id, tab.term, scrollback)
        replayIntoTerminal(tab.id, tab.term, '\r\n\x1b[2m[history restored]\x1b[0m\r\n')
        replayIntoTerminal(tab.id, tab.term, POST_REPLAY_MODE_RESET)
      }
    } catch {
      // ignore: best-effort replay
    }

    try {
      const id = await ipc.pty.spawn(worktreePathRef.current, { BRAID_TERMINAL_ID: tab.id })
      tab.ptyId = id
      const observer = createTerminalCommandObserver(worktreePathRef.current, { refreshWorktrees: true })
      tab.commandObserver = observer
      // Register for daemon-side scrollback persistence (writes ~/Braid/bigTerminals/<id>.scrollback on exit/kill/quit).
      ipc.pty.registerBigTerminal(id, tab.id)
      tab.term.onData((data: string) => {
        // Suppress xterm auto-replies emitted during scrollback replay.
        if (isReplaying(tab.id)) return
        observer.accept(data)
        ipc.pty.write(id, data)
      })
      requestAnimationFrame(() => {
        try { tab.fitAddon.fit(); ipc.pty.resize(id, tab.term.cols, tab.term.rows) } catch { /* ignore */ }
      })
      // Auto-run a queued command only on fresh terminals (not on restored history).
      if (pendingCommandRef.current && !hasScrollback) {
        const cmd = pendingCommandRef.current
        pendingCommandRef.current = null
        setTimeout(() => {
          observer.accept(cmd + '\n')
          ipc.pty.write(id, cmd + '\n')
        }, 100)
      }
    } catch (err) {
      tab.term.write(`\x1b[31mError: ${err instanceof Error ? err.message : 'Failed to spawn terminal'}\x1b[0m\r\n`)
    }
  }, [])

  const addTab = useCallback(() => {
    const tabId = nextTabId()
    const { term, fitAddon } = createTerminal()
    const newTab: TermTab = { id: tabId, label: 'Terminal', ptyId: null, term, fitAddon, resizeObserver: null }
    dispatch({ type: 'UPDATE_TABS', fn: (prev) => { const next = [...prev, newTab]; tabsRef.current = next; return next } })
    dispatch({ type: 'SET_ACTIVE', id: tabId })
    activeTabIdRef.current = tabId
    const cached = terminalCache.get(worktreePathRef.current)
    const nextTabs = cached ? [...cached.tabs, newTab] : [newTab]
    if (cached) { cached.tabs = nextTabs; cached.activeTabId = tabId }
    else { terminalCache.set(worktreePathRef.current, { tabs: nextTabs, activeTabId: tabId }) }
    pendingAttach.current.set(tabId, newTab)
    // Persist immediately so a daemon session can be reattached after restart -
    // unmount/worktree-switch saves don't run on app quit. (mirrors big terminals)
    saveRightTerminalTabs(worktreePathRef.current, nextTabs)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps — spawning happens via pendingAttach ref callback

  const closeTab = useCallback((tabId: string) => {
    dispatch({ type: 'UPDATE_TABS', fn: (prev) => {
      const idx = prev.findIndex((t) => t.id === tabId)
      const tab = prev[idx]
      if (tab) { if (tab.ptyId) ipc.pty.kill(tab.ptyId); ipc.pty.deleteScrollback(tabId); tab.commandObserver?.dispose(); tab.resizeObserver?.disconnect(); tab.term.dispose(); containerRefs.current.delete(tabId) }
      const next = prev.filter((t) => t.id !== tabId)
      tabsRef.current = next
      const cached = terminalCache.get(worktreePathRef.current)
      if (cached) cached.tabs = next
      saveRightTerminalTabs(worktreePathRef.current, next)
      if (activeTabIdRef.current === tabId) {
        const newActive = next[Math.min(idx, next.length - 1)]?.id ?? null
        dispatch({ type: 'SET_ACTIVE', id: newActive }); activeTabIdRef.current = newActive
        if (cached) cached.activeTabId = newActive
        if (newActive) { requestAnimationFrame(() => { const t = tabsRef.current.find((t) => t.id === newActive); if (t) { try { t.fitAddon.fit(); if (t.ptyId) ipc.pty.resize(t.ptyId, t.term.cols, t.term.rows) } catch { /* */ } } }) }
      }
      return next
    }})
  }, [])

  const switchTab = useCallback((tabId: string) => {
    dispatch({ type: 'SET_ACTIVE', id: tabId }); activeTabIdRef.current = tabId
    const cached = terminalCache.get(worktreePathRef.current)
    if (cached) cached.activeTabId = tabId
    requestAnimationFrame(() => {
      const tab = tabsRef.current.find((t) => t.id === tabId)
      if (tab) { try { tab.fitAddon.fit(); if (tab.ptyId) ipc.pty.resize(tab.ptyId, tab.term.cols, tab.term.rows) } catch { /* */ } }
    })
  }, [])

  // ── Rename ──────────────────────────────────────────────────────────────
  const startRename = useCallback((tabId: string, currentLabel: string, e: React.MouseEvent) => {
    e.stopPropagation(); dispatch({ type: 'SET_RENAMING', state: { tabId, draft: currentLabel } })
    requestAnimationFrame(() => renameInputRef.current?.select())
  }, [])

  const commitRename = useCallback(() => {
    if (!renaming) return
    const trimmed = renaming.draft.trim()
    if (trimmed) { dispatch({ type: 'UPDATE_TABS', fn: (prev) => { const next = prev.map((t) => t.id === renaming.tabId ? { ...t, label: trimmed } : t); const cached = terminalCache.get(worktreePathRef.current); if (cached) cached.tabs = next; saveRightTerminalTabs(worktreePathRef.current, next); return next } }) }
    dispatch({ type: 'SET_RENAMING', state: null })
  }, [renaming])

  const cancelRename = useCallback(() => dispatch({ type: 'SET_RENAMING', state: null }), [])

  // ── Redirect active tab when fixed tabs are hidden ───────────────────────
  // If Setup or Run is active but showFixedTabs=false, switch to first terminal tab
  // (the lifecycle will have called addTab() to ensure at least one exists)
  useEffect(() => {
    if (!showFixedTabs && isSpecialTab && tabs.length > 0) {
      switchTab(tabs[0].id)
    }
  }, [showFixedTabs, isSpecialTab, tabs[0]?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Lifecycle hooks (PTY routing, theme, font size, worktree switch) ───
  useTerminalLifecycle({
    worktreePath, collapsed, hidden, onToggleCollapse,
    worktreePathRef, tabsRef, activeTabIdRef, containerRefs, pendingAttach, pendingCommandRef,
    setTabs, setActiveTabId, addTab, attachTerm, setupResizeObserver,
  })

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', minHeight: 0 }}>
      {/* Tab bar */}
      <div
        ref={tabBarRef} onMouseDown={tabBarMouseDown} onWheel={handleWheel} onClickCapture={preventClickAfterDrag()}
        className={[
          'scrollbar-overlay',
          'terminal-tabs-shell',
          collapsed ? 'terminal-tabs-shell--collapsed' : '',
          tabBarDragging ? 'terminal-tabs-shell--dragging' : '',
        ].filter(Boolean).join(' ')}
      >
        <button
          type="button"
          className="terminal-tab-toggle"
          onClick={onToggleCollapse}
          aria-label={t('terminalToggleTooltip')}
        >
          {collapsed ? <IconChevronRight size={12} /> : <IconChevronDown size={12} />}
        </button>

        {showFixedTabs && (
          <>
            <FixedTabButton active={isSetupActive} icon={<IconSettings size={13} />} label={t('setupLabel')} onClick={() => activateFixedTab(SETUP_TAB_ID)} />
            <FixedTabButton active={isRunActive} icon={<IconPlay size={13} />} label={t('runLabel')} onClick={() => activateFixedTab(RUN_TAB_ID)} />
          </>
        )}

        {tabs.map((tab) => (
          <TerminalTabRow
            key={tab.id} tab={tab}
            isActive={activeTabId === tab.id} isHovered={hoveredTabId === tab.id}
            renaming={renaming} renameInputRef={renameInputRef}
            dragKey={dragKey} overKey={overKey}
            onSwitch={switchTab} onClose={closeTab}
            onStartRename={startRename} onCommitRename={commitRename}
            onCancelRename={cancelRename}
            onSetRenaming={(s) => dispatch({ type: 'SET_RENAMING', state: s })}
            onHover={(id) => dispatch({ type: 'SET_HOVERED', id })}
            onDragStart={onDragStart} onDragOver={onDragOver}
            onDragLeave={onDragLeave} onDrop={onDrop} onDragEnd={onDragEnd}
          />
        ))}

        <Tooltip content="New terminal">
          <button
            type="button"
            className="terminal-tab-add"
            onClick={addTab}
          >
            <IconPlus size={15} />
          </button>
        </Tooltip>
        <div className="terminal-tab-fill" />
      </div>

      {/* Content area */}
      {!collapsed && (
        <div ref={clipboardPasteRef} style={{ flex: 1, position: 'relative', minHeight: 0 }}>
          {showFixedTabs && (
            <>
              <div style={{ position: 'absolute', inset: 0, display: isSetupActive ? 'flex' : 'none' }}>
                <SetupPanel worktreePath={worktreePath} projectId={projectId} hidden={!isSetupActive} />
              </div>
              <div style={{ position: 'absolute', inset: 0, display: isRunActive ? 'flex' : 'none' }}>
                <RunPanel worktreePath={worktreePath} projectPath={projectPath} projectId={projectId} hidden={!isRunActive} />
              </div>
            </>
          )}
          {tabs.map((tab) => (
            <div
              key={tab.id}
              ref={(el) => {
                if (el) {
                  containerRefs.current.set(tab.id, el)
                  const pending = pendingAttach.current.get(tab.id)
                  if (pending) { pendingAttach.current.delete(tab.id); attachTerm(pending, el); setupResizeObserver(pending, el); spawnTab(pending) }
                  else if (tab.term.element && !el.contains(tab.term.element)) {
                    // Container was recreated (e.g. after collapse/uncollapse) — move the existing terminal element and re-observe
                    el.appendChild(tab.term.element)
                    setupResizeObserver(tab, el)
                  }
                }
              }}
              className="terminal-container"
              style={{ position: 'absolute', inset: 0, display: (!isSpecialTab && activeTabId === tab.id) ? 'block' : 'none' }}
              onDragOver={fileDrop.onDragOver}
              onDragEnter={fileDrop.onDragEnter}
              onDragLeave={fileDrop.onDragLeave}
              onDrop={fileDrop.onDrop}
            />
          ))}
        </div>
      )}
    </div>
  )
}
