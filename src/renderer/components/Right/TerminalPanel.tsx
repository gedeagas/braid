import { useEffect, useRef, useState } from 'react'
import type { Terminal } from '@xterm/xterm'
import * as ipc from '@/lib/ipc'
import { createTerminalCommandObserver } from '@/lib/terminalCommandRefresh'
import { getTerminalMinimumContrastRatio, getTerminalTheme } from '@/themes/terminal'
import { useUIStore } from '@/store/ui'
import { createTerminal, activateWebgl } from './terminalCache'
import '@xterm/xterm/css/xterm.css'

interface Props {
  worktreePath: string
}

export function TerminalPanel({ worktreePath }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const ptyIdRef = useRef<string | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  const commandObserverRef = useRef<ReturnType<typeof createTerminalCommandObserver> | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const { term, fitAddon } = createTerminal()
    term.open(containerRef.current)
    activateWebgl(term)
    termRef.current = term

    requestAnimationFrame(() => {
      try { fitAddon.fit() } catch { /* container not ready */ }
    })

    // Spawn PTY
    ipc.pty
      .spawn(worktreePath)
      .then((id: string) => {
        ptyIdRef.current = id
        const commandObserver = createTerminalCommandObserver(worktreePath, { refreshWorktrees: true })
        commandObserverRef.current = commandObserver

        term.onData((data: string) => {
          commandObserver.accept(data)
          ipc.pty.write(id, data)
        })

        const el = containerRef.current
        if (el) {
          const observer = new ResizeObserver(() => {
            try {
              fitAddon.fit()
              ipc.pty.resize(id, term.cols, term.rows)
            } catch { /* ignore resize errors */ }
          })
          observer.observe(el)
          observerRef.current = observer
        }
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Failed to spawn terminal'
        setError(msg)
        term.write(`\x1b[31mError: ${msg}\x1b[0m\r\n`)
      })

    // PTY -> Terminal
    const removeData = ipc.pty.onData((id: string, data: string) => {
      if (id === ptyIdRef.current) {
        term.write(data)
      }
    })

    const removeExit = ipc.pty.onExit((id: string) => {
      if (id === ptyIdRef.current) {
        term.write('\r\n\x1b[2m[Process exited]\x1b[0m\r\n')
      }
    })

    return () => {
      removeData()
      removeExit()
      observerRef.current?.disconnect()
      commandObserverRef.current?.dispose()
      commandObserverRef.current = null
      if (ptyIdRef.current) {
        ipc.pty.kill(ptyIdRef.current)
        ptyIdRef.current = null
      }
      term.dispose()
      termRef.current = null
    }
  }, [worktreePath])

  // Re-theme terminal when app theme changes
  useEffect(() => {
    let prevId = useUIStore.getState().activeThemeId
    const unsub = useUIStore.subscribe((state) => {
      if (state.activeThemeId !== prevId) {
        prevId = state.activeThemeId
        requestAnimationFrame(() => {
          if (termRef.current) {
            termRef.current.options.theme = getTerminalTheme()
            termRef.current.options.minimumContrastRatio = getTerminalMinimumContrastRatio()
          }
        })
      }
    })
    return unsub
  }, [])

  // Update terminal font size when setting changes
  useEffect(() => {
    let prevSize = useUIStore.getState().terminalFontSize
    const unsub = useUIStore.subscribe((state) => {
      if (state.terminalFontSize !== prevSize) {
        prevSize = state.terminalFontSize
        if (termRef.current) {
          termRef.current.options.fontSize = prevSize
        }
      }
    })
    return unsub
  }, [])

  // Update terminal scrollback when setting changes
  useEffect(() => {
    let prevScrollback = useUIStore.getState().terminalScrollback
    const unsub = useUIStore.subscribe((state) => {
      if (state.terminalScrollback !== prevScrollback) {
        prevScrollback = state.terminalScrollback
        if (termRef.current) {
          termRef.current.options.scrollback = prevScrollback
        }
      }
    })
    return unsub
  }, [])

  return <div className="terminal-container" ref={containerRef} />
}
