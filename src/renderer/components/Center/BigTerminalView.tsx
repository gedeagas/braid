import { useEffect, useRef, useCallback, useState } from 'react'
import * as ipc from '@/lib/ipc'
import { useTerminalFileDrop } from '@/hooks/useTerminalFileDrop'
import { getTerminalTheme } from '@/themes/terminal'
import { useUIStore } from '@/store/ui'
import { getOrCreate, type BigTermEntry } from './bigTerminalCache'
import { activateWebgl, disposeWebgl } from '@/components/Right/terminalCache'
import { TerminalSearch } from '@/components/shared/TerminalSearch'
import '@xterm/xterm/css/xterm.css'

interface Props {
  terminalId: string
  worktreePath: string
  initialCommand?: string
}

export function BigTerminalView({ terminalId, worktreePath, initialCommand }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const entryRef = useRef<BigTermEntry | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)

  // File-drop onto big terminal
  const getFileDropTarget = useCallback(() => {
    const entry = entryRef.current
    if (!entry) return null
    return { ptyId: entry.ptyId, focus: () => entry.term.focus() }
  }, [])
  const fileDrop = useTerminalFileDrop(getFileDropTarget)

  // Cmd+F / Ctrl+F opens terminal search
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
      e.preventDefault()
      e.stopPropagation()
      setSearchOpen(true)
    }
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    // Clear container of any stale children (safety net for tab switch).
    while (el.firstChild) el.removeChild(el.firstChild)

    const entry = getOrCreate(terminalId, worktreePath, initialCommand)
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
      if (entry.pendingFitRafId !== null) return
      entry.pendingFitRafId = requestAnimationFrame(() => {
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
  }, [terminalId, worktreePath])

  // Re-theme when app theme changes.
  useEffect(() => {
    let prevId = useUIStore.getState().activeThemeId
    const unsub = useUIStore.subscribe((state) => {
      if (state.activeThemeId !== prevId) {
        prevId = state.activeThemeId
        requestAnimationFrame(() => {
          const entry = entryRef.current
          if (entry) entry.term.options.theme = getTerminalTheme()
        })
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
          try { entry.fitAddon.fit() } catch { /* ignore */ }
        }
      }
    })
    return unsub
  }, [])

  return (
    <div
      className="big-terminal-container"
      style={{ position: 'relative' }}
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
      <div ref={containerRef} style={{ flex: 1, minHeight: 0, overflow: 'hidden' }} />
    </div>
  )
}
