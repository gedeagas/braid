import { useRef, useReducer, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import * as ipc from '@/lib/ipc'
import { useDragScroll } from '@/hooks/useDragScroll'
import { useTabReorder } from '@/hooks/useTabReorder'
import { Tooltip } from '@/components/shared/Tooltip'
import { SetupPanel } from './SetupPanel'
import { RunPanel } from './RunPanel'
import { TerminalTabRow } from './TerminalTabRow'
import {
  SETUP_TAB_ID, RUN_TAB_ID,
  terminalCache, nextTabId, createTerminal,
  type TermTab, type RenameState,
} from './terminalCache'
import { useTerminalLifecycle } from './useTerminalLifecycle'
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
  active: boolean; icon: string; label: string; onClick: () => void
}) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 5, padding: '0 12px',
        height: 36, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap',
        borderRight: '1px solid var(--border)',
        background: active ? 'var(--bg-primary)' : 'transparent',
        color: active ? 'var(--text-primary)' : 'var(--text-muted)',
        boxShadow: active ? 'inset 0 -2px 0 var(--accent)' : 'none',
        userSelect: 'none', transition: 'background 0.1s, color 0.1s',
      }}
      onMouseEnter={(e) => {
        if (!active) {
          ;(e.currentTarget as HTMLElement).style.background = 'var(--bg-tertiary)'
          ;(e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          ;(e.currentTarget as HTMLElement).style.background = 'transparent'
          ;(e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'
        }
      }}
    >
      <span style={{ fontSize: 13, opacity: 0.6 }}>{icon}</span>
      <span>{label}</span>
    </div>
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
  const worktreePathRef = useRef(worktreePath)
  worktreePathRef.current = worktreePath
  const pendingCommandRef = useRef<string | null>(null)
  const { onMouseDown: tabBarMouseDown, isDragging: tabBarDragging, preventClickAfterDrag } = useDragScroll(tabBarRef)

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
      return next
    }})
  }, [])

  const tabKeys = tabs.map((t) => t.id)
  const { dragKey, overKey, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd } = useTabReorder(tabKeys, reorderTabs)

  // ── Terminal operations ─────────────────────────────────────────────────
  const attachTerm = useCallback((tab: TermTab, el: HTMLDivElement) => {
    if (!tab.term.element) { tab.term.open(el) } else { el.appendChild(tab.term.element) }
    requestAnimationFrame(() => {
      try { tab.fitAddon.fit(); if (tab.ptyId) ipc.pty.resize(tab.ptyId, tab.term.cols, tab.term.rows) }
      catch { /* ignore */ }
    })
  }, [])

  const setupResizeObserver = useCallback((tab: TermTab, el: HTMLDivElement) => {
    tab.resizeObserver?.disconnect()
    const observer = new ResizeObserver(() => {
      if (activeTabIdRef.current === tab.id) {
        try { tab.fitAddon.fit(); if (tab.ptyId) ipc.pty.resize(tab.ptyId, tab.term.cols, tab.term.rows) }
        catch { /* ignore */ }
      }
    })
    observer.observe(el)
    tab.resizeObserver = observer
  }, [])

  const spawnTab = useCallback(async (tab: TermTab) => {
    try {
      const id = await ipc.pty.spawn(worktreePathRef.current)
      tab.ptyId = id
      tab.term.onData((data: string) => ipc.pty.write(id, data))
      requestAnimationFrame(() => {
        try { tab.fitAddon.fit(); ipc.pty.resize(id, tab.term.cols, tab.term.rows) } catch { /* ignore */ }
      })
      if (pendingCommandRef.current) {
        const cmd = pendingCommandRef.current
        pendingCommandRef.current = null
        setTimeout(() => ipc.pty.write(id, cmd + '\n'), 100)
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
    if (cached) { cached.tabs = [...cached.tabs, newTab]; cached.activeTabId = tabId }
    else { terminalCache.set(worktreePathRef.current, { tabs: [newTab], activeTabId: tabId }) }
    pendingAttach.current.set(tabId, newTab)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps — spawning happens via pendingAttach ref callback

  const closeTab = useCallback((tabId: string) => {
    dispatch({ type: 'UPDATE_TABS', fn: (prev) => {
      const idx = prev.findIndex((t) => t.id === tabId)
      const tab = prev[idx]
      if (tab) { if (tab.ptyId) ipc.pty.kill(tab.ptyId); tab.resizeObserver?.disconnect(); tab.term.dispose(); containerRefs.current.delete(tabId) }
      const next = prev.filter((t) => t.id !== tabId)
      tabsRef.current = next
      const cached = terminalCache.get(worktreePathRef.current)
      if (cached) cached.tabs = next
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
    if (trimmed) { dispatch({ type: 'UPDATE_TABS', fn: (prev) => { const next = prev.map((t) => t.id === renaming.tabId ? { ...t, label: trimmed } : t); const cached = terminalCache.get(worktreePathRef.current); if (cached) cached.tabs = next; return next } }) }
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
        className="scrollbar-overlay"
        style={{
          display: 'flex', alignItems: 'stretch', background: 'var(--bg-secondary)',
          flexShrink: 0, overflowX: 'auto', overflowY: 'hidden',
          borderBottom: collapsed ? 'none' : '1px solid var(--border)',
          cursor: tabBarDragging ? 'grabbing' : undefined,
          userSelect: tabBarDragging ? 'none' : undefined,
        }}
      >
        <span
          style={{ fontSize: 12, padding: '0 6px 0 10px', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', flexShrink: 0 }}
          onClick={onToggleCollapse}
        >{collapsed ? '▶' : '▼'}</span>

        {showFixedTabs && (
          <>
            <FixedTabButton active={isSetupActive} icon="⚙" label={t('setupLabel')} onClick={() => activateFixedTab(SETUP_TAB_ID)} />
            <FixedTabButton active={isRunActive} icon="▶" label={t('runLabel')} onClick={() => activateFixedTab(RUN_TAB_ID)} />
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
            onClick={addTab}
            style={{
              background: 'none', border: 'none', color: 'var(--text-secondary)',
              cursor: 'pointer', padding: '0 14px', fontSize: 20, lineHeight: 1,
              height: 36, flexShrink: 0, display: 'flex', alignItems: 'center',
              transition: 'color 0.1s, background 0.1s',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'; (e.currentTarget as HTMLElement).style.background = 'var(--accent-tint-8)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'; (e.currentTarget as HTMLElement).style.background = 'transparent' }}
          >+</button>
        </Tooltip>
        <div style={{ flex: 1 }} />
      </div>

      {/* Content area */}
      {!collapsed && (
        <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
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
                    // Container was recreated (e.g. after collapse/uncollapse) — re-attach and re-observe
                    attachTerm(tab, el)
                    setupResizeObserver(tab, el)
                  }
                }
              }}
              className="terminal-container"
              style={{ position: 'absolute', inset: 0, display: (!isSpecialTab && activeTabId === tab.id) ? 'block' : 'none' }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
