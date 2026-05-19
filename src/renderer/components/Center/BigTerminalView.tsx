import { useEffect, useRef, useCallback, useState } from 'react'
import * as ipc from '@/lib/ipc'
import { FILE_PATH_MIME } from '@/lib/fileDragMime'
import { shellEscapePath } from '@/lib/shellEscapePath'
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

    const entry = getOrCreate(terminalId, worktreePath, initialCommand)
    entryRef.current = entry

    // Attach xterm to DOM (open on first mount, re-append on remount).
    if (!entry.term.element) {
      entry.term.open(el)
      activateWebgl(entry.term)
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

  return (
    <div
      className="big-terminal-container"
      style={{ position: 'relative' }}
      onKeyDown={handleKeyDown}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(FILE_PATH_MIME)) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }
      }}
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes(FILE_PATH_MIME)) {
          e.currentTarget.classList.add('terminal-drop-target')
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          e.currentTarget.classList.remove('terminal-drop-target')
        }
      }}
      onDrop={(e) => {
        const filePath = e.dataTransfer.getData(FILE_PATH_MIME)
        if (!filePath) return
        e.preventDefault()
        e.stopPropagation()
        e.currentTarget.classList.remove('terminal-drop-target')
        const entry = entryRef.current
        if (entry?.ptyId) {
          ipc.pty.write(entry.ptyId, shellEscapePath(filePath) + ' ')
          entry.term.focus()
        }
      }}
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
