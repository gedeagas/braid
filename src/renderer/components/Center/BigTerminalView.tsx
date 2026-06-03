import { useEffect, useRef, useCallback, useReducer, useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as ipc from '@/lib/ipc'
import { useTerminalFileDrop } from '@/hooks/useTerminalFileDrop'
import { useTerminalClipboardPaste } from '@/hooks/useTerminalClipboardPaste'
import { useUIStore } from '@/store/ui'
import { getOrCreate, reThemeAllBigTerminals, updateBigTerminalAgentId, updateScrollbackAllBigTerminals, type BigTermEntry } from './bigTerminalCache'
import { activateWebgl, disposeWebgl } from '@/components/Right/terminalCache'
import { TerminalSearch } from '@/components/shared/TerminalSearch'
import { BranchBar } from './BranchBar'
import '@xterm/xterm/css/xterm.css'

interface Props {
  terminalId: string
  worktreePath: string
  initialCommand?: string
  initialInput?: string
  agentId?: string
}

// Consolidated mobile-driver UI state (kept in a reducer so the component stays
// within the 2-useState budget while tracking related flags).
//   active      - a paired phone is subscribed to (driving) this terminal
//   mode        - 'desktop' means the phone/desktop asked to view at the desktop's
//                 native size, so we stop yielding
//   collapsed   - the "Mobile is driving" overlay is minimized to a corner chip
//   fitOverride - the PTY is sized to the phone's viewport. Persists after the
//                 phone detaches so the desktop shows a "Held at phone size"
//                 prompt (instead of silently auto-resizing).
type MobileUiState = { active: boolean; mode: 'phone' | 'desktop'; collapsed: boolean; fitOverride: boolean }
type MobileUiAction =
  | { type: 'active'; active: boolean }
  | { type: 'mode'; mode: 'phone' | 'desktop' }
  | { type: 'collapsed'; collapsed: boolean }
  | { type: 'fitOverride'; value: boolean }
  | { type: 'restore' }
  | { type: 'resetForTerminal' }

function mobileUiReducer(state: MobileUiState, action: MobileUiAction): MobileUiState {
  switch (action.type) {
    case 'active':
      // Keep fitOverride on detach so the held-at-phone-size prompt can appear;
      // collapse only applies while actively driving, so clear it.
      return { ...state, active: action.active, collapsed: action.active ? state.collapsed : false }
    case 'mode':
      return state.mode === action.mode ? state : { ...state, mode: action.mode }
    case 'collapsed':
      return state.collapsed === action.collapsed ? state : { ...state, collapsed: action.collapsed }
    case 'fitOverride':
      return state.fitOverride === action.value ? state : { ...state, fitOverride: action.value }
    case 'restore':
      // Desktop reclaims: drop the phone-fit override and any collapse, and mark
      // desktop mode so the pane fits to its own size again.
      return { ...state, mode: 'desktop', collapsed: false, fitOverride: false }
    case 'resetForTerminal':
      return { active: state.active, mode: 'phone', collapsed: false, fitOverride: false }
    default:
      return state
  }
}

export function BigTerminalView({ terminalId, worktreePath, initialCommand, initialInput, agentId }: Props) {
  const { t } = useTranslation('center')
  const containerRef = useRef<HTMLDivElement>(null)
  const entryRef = useRef<BigTermEntry | null>(null)
  // Last phone-fit dims a paired device applied to the shared PTY, and a live
  // mirror of `driving` so the (terminalId-scoped) mobile-fit listener can read
  // the current state without re-subscribing.
  const mobileFitRef = useRef<{ cols: number; rows: number } | null>(null)
  const drivingRef = useRef(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [mobileUi, dispatchMobileUi] = useReducer(mobileUiReducer, { active: false, mode: 'phone', collapsed: false, fitOverride: false })

  // File-drop onto big terminal
  const getFileDropTarget = useCallback(() => {
    const entry = entryRef.current
    if (!entry) return null
    return { ptyId: entry.ptyId, focus: () => entry.term.focus() }
  }, [])
  const fileDrop = useTerminalFileDrop(getFileDropTarget)
  const clipboardPasteRef = useTerminalClipboardPaste(getFileDropTarget)

  // Cmd+F / Ctrl+F opens terminal search
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
      e.preventDefault()
      e.stopPropagation()
      setSearchOpen(true)
    }
  }, [])

  useEffect(() => {
    dispatchMobileUi({ type: 'resetForTerminal' })
    let cancelled = false
    ipc.pty.isMobileTerminalActive(terminalId)
      .then((active) => { if (!cancelled) dispatchMobileUi({ type: 'active', active }) })
      .catch(() => undefined)
    const unsubscribe = ipc.pty.onMobileTerminalActive((status) => {
      if (status.terminalId === terminalId) dispatchMobileUi({ type: 'active', active: status.active })
    })
    const unsubscribeMode = ipc.pty.onMobileDisplayMode((status) => {
      if (status.terminalId === terminalId) dispatchMobileUi({ type: 'mode', mode: status.mode })
    })
    // While a phone is driving, size our xterm to the phone's PTY dims so the
    // buffer is laid out at the width the phone shows (output streams correctly
    // underneath the "Mobile is driving" overlay). Also record the phone-fit
    // override so a "Held at phone size" prompt can appear after the phone leaves.
    const unsubscribeFit = ipc.pty.onMobileFit((status) => {
      if (status.terminalId !== terminalId) return
      mobileFitRef.current = { cols: status.cols, rows: status.rows }
      dispatchMobileUi({ type: 'fitOverride', value: true })
      if (!drivingRef.current) return
      const entry = entryRef.current
      if (!entry || entry.disposed) return
      if (entry.term.cols === status.cols && entry.term.rows === status.rows) return
      try { entry.term.resize(status.cols, status.rows) } catch { /* ignore */ }
    })
    return () => {
      cancelled = true
      unsubscribe()
      unsubscribeMode()
      unsubscribeFit()
    }
  }, [terminalId])

  // A phone is actively driving (input paused on the desktop) unless we're in
  // 'desktop' mode. After the phone detaches, a lingering phone-fit override puts
  // the pane in a "held at phone size" state until the desktop restores.
  const driving = mobileUi.active && mobileUi.mode !== 'desktop'
  const held = !mobileUi.active && mobileUi.fitOverride && mobileUi.mode !== 'desktop'
  // Desktop input + auto-fit are suppressed in both states (the PTY is the
  // phone's size; fitting it to our pane would clobber the phone's output).
  const locked = driving || held
  drivingRef.current = driving

  // Desktop reclaims control: tell main the terminal is driven at desktop dims
  // (it broadcasts 'desktop' back, lifting the main-side resize guard), and drop
  // our local hold so the pane re-fits. Used by Take back, Restore, and
  // type-to-take-back.
  const takeBack = useCallback(() => {
    dispatchMobileUi({ type: 'restore' })
    ipc.pty.setMobileDisplayMode(terminalId, 'desktop')
  }, [terminalId])

  // Lock the desktop xterm's input while a phone owns the terminal: keystrokes
  // are not forwarded to the PTY; instead they reclaim control (type = take
  // back).
  useEffect(() => {
    const entry = entryRef.current
    if (!entry) return
    entry.mobileInputLocked = locked
    entry.onDesktopInputWhileLocked = locked ? takeBack : null
    return () => {
      const e = entryRef.current
      if (e) { e.mobileInputLocked = false; e.onDesktopInputWhileLocked = null }
    }
  }, [locked, takeBack, terminalId])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    // Clear container of any stale children (safety net for tab switch).
    while (el.firstChild) el.removeChild(el.firstChild)

    const entry = getOrCreate(terminalId, worktreePath, initialCommand, agentId, initialInput)
    entryRef.current = entry
    entry.mobileInputLocked = locked
    entry.onDesktopInputWhileLocked = locked ? takeBack : null

    // Attach xterm to DOM (open on first mount, re-append on remount).
    if (!entry.term.element) {
      entry.term.open(el)
      // First mount - activate WebGL, track addon on entry.
      entry.webglAddon = activateWebgl(entry.term, () => {
        // Context loss callback - permanently disable WebGL for this pane.
        console.warn('[terminal] WebGL context lost for', terminalId, '- falling back to canvas')
        entry.webglDisabledAfterContextLoss = true
        entry.webglAddon = null
      })
    } else {
      // Re-mount after tab switch. DOM reparenting can silently invalidate
      // WebGL context without firing contextlost, so reattach after append.
      el.appendChild(entry.term.element)
      if (!entry.webglDisabledAfterContextLoss && !entry.webglAddon) {
        entry.webglAddon = activateWebgl(entry.term, () => {
          entry.webglDisabledAfterContextLoss = true
          entry.webglAddon = null
        })
      }
    }

    // rAF-coalesced fit: ResizeObserver can fire many times during a single
    // frame (e.g. split resize drag). Coalesce into one rAF to avoid loops
    // and keep fit() off the pointermove hot path.
    const scheduleFit = () => {
      if (locked) return
      if (entry.pendingFitRafId !== null) return
      entry.pendingFitRafId = requestAnimationFrame(() => {
        if (locked) {
          entry.pendingFitRafId = null
          return
        }
        entry.pendingFitRafId = null
        try {
          entry.fitAddon.fit()
          if (entry.ptyId) ipc.pty.resize(entry.ptyId, entry.term.cols, entry.term.rows)
        } catch { /* ignore */ }
      })
    }

    scheduleFit()

    const observer = new ResizeObserver(scheduleFit)
    observer.observe(el)
    entry.resizeObserver?.disconnect()
    entry.resizeObserver = observer

    // After PTY spawn completes, fit again (dimensions may have changed).
    entry.spawnPromise.then(scheduleFit)

    return () => {
      // Do NOT dispose xterm - tab may be reactivated.
      observer.disconnect()
      if (entry.resizeObserver === observer) entry.resizeObserver = null
      // Cancel any pending fit rAF
      if (entry.pendingFitRafId !== null) {
        cancelAnimationFrame(entry.pendingFitRafId)
        entry.pendingFitRafId = null
      }
      // Dispose WebGL BEFORE detaching from DOM to avoid silent context
      // corruption. Will reattach on next mount.
      disposeWebgl(entry.webglAddon)
      entry.webglAddon = null
      // Detach terminal element from container without disposing xterm
      if (entry.term.element && el.contains(entry.term.element)) {
        el.removeChild(entry.term.element)
      }
    }
  }, [terminalId, worktreePath, locked, takeBack])

  // Robust restore when the pane stops being locked (take back / restore). The
  // mount effect's single rAF fit() can silently no-op if it measured the
  // container before layout settled, leaving xterm - sized to the phone's dims
  // while locked - and the shared PTY parked narrow. A short fallback re-measures
  // and force-fits if xterm is still stuck at the phone dims.
  const prevLockedRef = useRef(locked)
  useEffect(() => {
    const wasLocked = prevLockedRef.current
    prevLockedRef.current = locked
    if (!wasLocked || locked) return // only on the locked -> unlocked transition

    const entry = entryRef.current
    const el = containerRef.current
    if (!entry || !el) return

    const phoneFit = mobileFitRef.current
    const stuckCols = entry.term.cols
    const stuckRows = entry.term.rows

    const rafId = requestAnimationFrame(() => {
      try {
        entry.fitAddon.fit()
        if (entry.ptyId) ipc.pty.resize(entry.ptyId, entry.term.cols, entry.term.rows)
      } catch { /* ignore */ }
    })

    const timerId = window.setTimeout(() => {
      if (entry.disposed) return
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      const stillStuck =
        entry.term.cols === stuckCols &&
        entry.term.rows === stuckRows &&
        (!phoneFit || (entry.term.cols === phoneFit.cols && entry.term.rows === phoneFit.rows))
      if (!stillStuck) return
      try {
        const proposed = entry.fitAddon.proposeDimensions()
        if (proposed && (proposed.cols !== entry.term.cols || proposed.rows !== entry.term.rows)) {
          entry.fitAddon.fit()
          if (entry.ptyId) ipc.pty.resize(entry.ptyId, entry.term.cols, entry.term.rows)
        }
      } catch { /* ignore */ }
    }, 100)

    return () => {
      cancelAnimationFrame(rafId)
      window.clearTimeout(timerId)
    }
  }, [locked])

  useEffect(() => {
    updateBigTerminalAgentId(terminalId, agentId)
  }, [terminalId, agentId])

  // Re-theme ALL cached big terminals when app theme changes (not just this one).
  useEffect(() => {
    let prevId = useUIStore.getState().activeThemeId
    const unsub = useUIStore.subscribe((state) => {
      if (state.activeThemeId !== prevId) {
        prevId = state.activeThemeId
        requestAnimationFrame(() => reThemeAllBigTerminals())
      }
    })
    return unsub
  }, [])

  // Live terminal font size.
  useEffect(() => {
    let prevSize = useUIStore.getState().terminalFontSize
    const unsub = useUIStore.subscribe((state) => {
      if (state.terminalFontSize !== prevSize) {
        prevSize = state.terminalFontSize
        const entry = entryRef.current
        if (entry) {
          entry.term.options.fontSize = prevSize
          try {
            entry.fitAddon.fit()
            if (entry.ptyId) ipc.pty.resize(entry.ptyId, entry.term.cols, entry.term.rows)
          } catch { /* ignore */ }
        }
      }
    })
    return unsub
  }, [])

  // Live terminal scrollback.
  useEffect(() => {
    let prevScrollback = useUIStore.getState().terminalScrollback
    const unsub = useUIStore.subscribe((state) => {
      if (state.terminalScrollback !== prevScrollback) {
        prevScrollback = state.terminalScrollback
        updateScrollbackAllBigTerminals(prevScrollback)
      }
    })
    return unsub
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div
        ref={clipboardPasteRef}
        className="big-terminal-container"
        style={{ position: 'relative', flex: 1, minHeight: 0 }}
        onKeyDown={handleKeyDown}
        onDragOver={fileDrop.onDragOver}
        onDragEnter={fileDrop.onDragEnter}
        onDragLeave={fileDrop.onDragLeave}
        onDrop={fileDrop.onDrop}
      >
        {searchOpen && entryRef.current && (
          <TerminalSearch
            searchAddon={entryRef.current.searchAddon}
            onClose={() => setSearchOpen(false)}
          />
        )}
        {/* While a phone is driving, the terminal stays visible and live output
            keeps streaming - desktop input is paused (xterm.onData is gated in
            bigTerminalCache; typing reclaims control). Expanded: a card with Take
            back + Collapse. Collapsed: a corner chip; the terminal is left
            interactive for watching/scrolling, and typing takes back. */}
        {driving && !mobileUi.collapsed && (
          <div
            className="mobile-driver-overlay"
            style={{
              position: 'absolute', inset: 0, zIndex: 2, display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              background: 'color-mix(in srgb, var(--bg-primary) 78%, transparent)',
              padding: 24,
            }}
          >
            <div style={{ width: 'min(420px, 100%)', borderRadius: 8, background: 'var(--bg-secondary)', border: '1px solid var(--border)', padding: 20, color: 'var(--text-primary)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--accent)', fontSize: 12, fontWeight: 600, marginBottom: 12 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--accent)' }} />
                <span>{t('mobileDriver.drivingEyebrow')}</span>
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>{t('mobileDriver.drivingTitle')}</div>
              <div style={{ color: 'var(--text-secondary)', lineHeight: 1.55, marginBottom: 18 }}>{t('mobileDriver.drivingBody')}</div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button className="btn" onClick={() => dispatchMobileUi({ type: 'collapsed', collapsed: true })}>{t('mobileDriver.collapse')}</button>
                <button className="btn btn-primary" onClick={takeBack}>{t('mobileDriver.takeBack')}</button>
              </div>
            </div>
          </div>
        )}
        {driving && mobileUi.collapsed && (
          <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 3, display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 999, padding: '5px 8px 5px 12px', boxShadow: 'var(--shadow-elevation-lg)' }}>
            <span style={{ width: 7, height: 7, borderRadius: 999, background: 'var(--accent)' }} />
            <button
              style={{ all: 'unset', cursor: 'pointer', fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}
              onClick={() => dispatchMobileUi({ type: 'collapsed', collapsed: false })}
            >
              {t('mobileDriver.chipLabel')}
            </button>
            <button className="btn btn-primary" style={{ padding: '3px 9px', fontSize: 11 }} onClick={takeBack}>{t('mobileDriver.takeBack')}</button>
          </div>
        )}
        {/* The phone left but the PTY is still sized for it: prompt the user to
            restore the desktop size (we don't auto-resize the held buffer). */}
        {held && (
          <div
            style={{
              position: 'absolute', inset: 0, zIndex: 2, display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              background: 'var(--bg-primary)', padding: 24,
            }}
          >
            <div style={{ width: 'min(480px, 100%)', borderRadius: 8, background: 'var(--bg-secondary)', border: '1px solid var(--border)', padding: 24, color: 'var(--text-primary)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)', fontSize: 13, marginBottom: 14 }}>
                <span style={{ width: 9, height: 9, borderRadius: 999, background: 'var(--text-secondary)' }} />
                <span>{t('heldForMobile.eyebrow')}</span>
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>{t('heldForMobile.title')}</div>
              <div style={{ color: 'var(--text-secondary)', lineHeight: 1.55, marginBottom: 18 }}>{t('heldForMobile.body')}</div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn btn-primary" onClick={takeBack}>{t('heldForMobile.restore')}</button>
              </div>
            </div>
          </div>
        )}
        <div ref={containerRef} style={{ width: '100%', height: '100%', overflow: 'hidden' }} />
      </div>
      {agentId && (
        <div className="chat-input-footer">
          <BranchBar />
        </div>
      )}
    </div>
  )
}
