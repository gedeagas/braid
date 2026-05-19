import { useEffect, useRef, useCallback, useState } from 'react'
import * as ipc from '@/lib/ipc'
import { useTerminalFileDrop } from '@/hooks/useTerminalFileDrop'
import { getTerminalTheme } from '@/themes/terminal'
import { useUIStore } from '@/store/ui'
import { getOrCreate, type BigTermEntry } from './bigTerminalCache'
import { activateWebgl } from '@/components/Right/terminalCache'
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

    // Detach any previously attached terminal element (tab switch).
    // This prevents stacking multiple WebGL canvases in one container,
    // which causes ResizeObserver loops and GPU context fights.
    while (el.firstChild) el.removeChild(el.firstChild)

    const entry = getOrCreate(terminalId, worktreePath, initialCommand)
    entryRef.current = entry

    // Attach xterm to DOM (open on first mount, re-append on remount).
    if (!entry.term.element) {
      entry.term.open(el)
      activateWebgl(entry.term)
    } else {
      el.appendChild(entry.term.element)
    }

    // Guard against re-entrant ResizeObserver -> fit() -> resize -> ResizeObserver loops.
    let fitting = false
    const doFit = () => {
      if (fitting) return
      fitting = true
      try {
        entry.fitAddon.fit()
        if (entry.ptyId) ipc.pty.resize(entry.ptyId, entry.term.cols, entry.term.rows)
      } catch { /* ignore */ }
      fitting = false
    }

    requestAnimationFrame(doFit)

    const observer = new ResizeObserver(doFit)
    observer.observe(el)
    entry.resizeObserver?.disconnect()
    entry.resizeObserver = observer

    // After PTY spawn completes, fit again (dimensions may have changed).
    entry.spawnPromise.then(() => {
      requestAnimationFrame(doFit)
    })

    return () => {
      // Do NOT dispose — tab may be reactivated. Just detach observer and element.
      observer.disconnect()
      if (entry.resizeObserver === observer) entry.resizeObserver = null
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
