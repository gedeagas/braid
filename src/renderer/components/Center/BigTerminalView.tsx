import { useEffect, useRef } from 'react'
import * as ipc from '@/lib/ipc'
import { getTerminalTheme } from '@/themes/terminal'
import { useUIStore } from '@/store/ui'
import { getOrCreate, type BigTermEntry } from './bigTerminalCache'
import '@xterm/xterm/css/xterm.css'

interface Props {
  terminalId: string
  worktreePath: string
}

export function BigTerminalView({ terminalId, worktreePath }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const entryRef = useRef<BigTermEntry | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const entry = getOrCreate(terminalId, worktreePath)
    entryRef.current = entry

    // Attach xterm to DOM (open on first mount, re-append on remount).
    if (!entry.term.element) {
      entry.term.open(el)
    } else if (!el.contains(entry.term.element)) {
      el.appendChild(entry.term.element)
    }

    requestAnimationFrame(() => {
      try {
        entry.fitAddon.fit()
        if (entry.ptyId) ipc.pty.resize(entry.ptyId, entry.term.cols, entry.term.rows)
      } catch { /* container not ready */ }
    })

    const observer = new ResizeObserver(() => {
      try {
        entry.fitAddon.fit()
        if (entry.ptyId) ipc.pty.resize(entry.ptyId, entry.term.cols, entry.term.rows)
      } catch { /* ignore */ }
    })
    observer.observe(el)
    entry.resizeObserver?.disconnect()
    entry.resizeObserver = observer

    // After PTY spawn completes, fit again (dimensions may have changed).
    entry.spawnPromise.then(() => {
      try {
        entry.fitAddon.fit()
        if (entry.ptyId) ipc.pty.resize(entry.ptyId, entry.term.cols, entry.term.rows)
      } catch { /* ignore */ }
    })

    return () => {
      // Do NOT dispose — tab may be reactivated. Just detach observer.
      observer.disconnect()
      if (entry.resizeObserver === observer) entry.resizeObserver = null
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

  return <div className="big-terminal-container" ref={containerRef} />
}
