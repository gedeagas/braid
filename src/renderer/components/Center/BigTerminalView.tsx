import { useEffect, useRef, useCallback, useState } from 'react'
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

export function BigTerminalView({ terminalId, worktreePath, initialCommand, initialInput, agentId }: Props) {
  const { t } = useTranslation('center')
  const containerRef = useRef<HTMLDivElement>(null)
  const entryRef = useRef<BigTermEntry | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [mobileActive, setMobileActive] = useState(false)
  // 'desktop' means the paired phone (or the desktop's "Restore desktop size"
  // button) asked to view this terminal at the desktop's native size, so we
  // release the hold and fit to our own pane.
  const [mobileDisplayMode, setMobileDisplayMode] = useState<'phone' | 'desktop'>('phone')

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
    setMobileDisplayMode('phone')
    let cancelled = false
    ipc.pty.isMobileTerminalActive(terminalId)
      .then((active) => { if (!cancelled) setMobileActive(active) })
      .catch(() => undefined)
    const unsubscribe = ipc.pty.onMobileTerminalActive((status) => {
      if (status.terminalId === terminalId) {
        setMobileActive(status.active)
        if (!status.active) {
          setMobileDisplayMode('phone')
        }
      }
    })
    const unsubscribeMode = ipc.pty.onMobileDisplayMode((status) => {
      if (status.terminalId === terminalId) setMobileDisplayMode(status.mode)
    })
    return () => {
      cancelled = true
      unsubscribe()
      unsubscribeMode()
    }
  }, [terminalId])

  // In 'desktop' mode the phone wants our native size, so we stop holding and
  // let the ResizeObserver fit to this pane (which resizes the shared PTY).
  const heldForMobile = mobileActive && mobileDisplayMode !== 'desktop'

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    // Clear container of any stale children (safety net for tab switch).
    while (el.firstChild) el.removeChild(el.firstChild)

    const entry = getOrCreate(terminalId, worktreePath, initialCommand, agentId, initialInput)
    entryRef.current = entry

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
      if (heldForMobile) return
      if (entry.pendingFitRafId !== null) return
      entry.pendingFitRafId = requestAnimationFrame(() => {
        if (heldForMobile) {
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
  }, [terminalId, worktreePath, heldForMobile])

  const restoreDesktopSize = useCallback(() => {
    // Tell the main process the terminal is now driven at desktop dimensions.
    // It broadcasts back a 'desktop' display mode which un-holds this pane
    // (heldForMobile -> false), re-fits, and resizes the shared PTY. Because
    // the mode is set on main *before* that resize fires, the resulting
    // `terminal.resized` event is tagged 'desktop', so the paired phone
    // resizes its xterm and toggles its desktop/phone indicator.
    //
    // We intentionally do NOT set desktopOverride or resize locally here:
    // doing so would un-hold the pane and emit a 'phone'-tagged resize before
    // main learns about the mode change, and the later broadcast would be a
    // no-op (heldForMobile already false), leaving the phone out of sync.
    ipc.pty.setMobileDisplayMode(terminalId, 'desktop')
  }, [terminalId])

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
        {heldForMobile && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 2,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--bg-primary)',
              padding: 24,
            }}
          >
            <div
              style={{
                width: 'min(480px, 100%)',
                borderRadius: 8,
                background: 'var(--bg-secondary)',
                padding: 24,
                color: 'var(--text-primary)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)', fontSize: 13, marginBottom: 14 }}>
                <span style={{ width: 9, height: 9, borderRadius: 999, background: 'var(--text-secondary)' }} />
                <span>{t('heldForMobile.eyebrow')}</span>
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>
                {t('heldForMobile.title')}
              </div>
              <div style={{ color: 'var(--text-secondary)', lineHeight: 1.55, marginBottom: 18 }}>
                {t('heldForMobile.body')}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn btn-primary" onClick={restoreDesktopSize}>{t('heldForMobile.restore')}</button>
              </div>
            </div>
          </div>
        )}
        <div ref={containerRef} style={{ width: '100%', height: '100%', overflow: 'hidden', visibility: heldForMobile ? 'hidden' : 'visible' }} />
      </div>
      {agentId && (
        <div className="chat-input-footer">
          <BranchBar />
        </div>
      )}
    </div>
  )
}
