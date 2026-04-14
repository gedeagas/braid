import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import * as ipc from '@/lib/ipc'
import { getTerminalTheme } from '@/themes/terminal'
import { useUIStore } from '@/store/ui'
import '@xterm/xterm/css/xterm.css'

interface Props {
  worktreePath: string
}

export function TerminalPanel({ worktreePath }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const ptyIdRef = useRef<string | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({
      theme: getTerminalTheme(),
      fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
      fontSize: useUIStore.getState().terminalFontSize,
      cursorBlink: true,
      allowProposedApi: true
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)
    termRef.current = term

    requestAnimationFrame(() => {
      try { fitAddon.fit() } catch { /* container not ready */ }
    })

    // Spawn PTY
    ipc.pty
      .spawn(worktreePath)
      .then((id: string) => {
        ptyIdRef.current = id

        term.onData((data: string) => {
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

  return <div className="terminal-container" ref={containerRef} />
}
