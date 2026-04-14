import { useEffect, useRef, useCallback, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { useTranslation } from 'react-i18next'
import * as ipc from '@/lib/ipc'
import { useUIStore } from '@/store/ui'
import { useProjectsStore } from '@/store/projects'
import { getTerminalTheme } from '@/themes/terminal'
import { IconWrench } from '@/components/shared/icons'
import { Button, EmptyState } from '@/components/ui'
import '@xterm/xterm/css/xterm.css'

interface Props {
  worktreePath: string
  projectId: string
  hidden?: boolean
}

// ── Module-level cache ──────────────────────────────────────────────────────

interface CachedSetup {
  term: Terminal
  fitAddon: FitAddon
  ptyId: string | null
  running: boolean
  cleanupListeners: (() => void)[]
}

const setupCache = new Map<string, CachedSetup>()

function getOrCreateCache(worktreePath: string): CachedSetup {
  const existing = setupCache.get(worktreePath)
  if (existing) return existing

  const term = new Terminal({
    theme: getTerminalTheme(),
    fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
    fontSize: useUIStore.getState().terminalFontSize,
    cursorBlink: false,
    disableStdin: true,
    allowProposedApi: true
  })
  const fitAddon = new FitAddon()
  term.loadAddon(fitAddon)

  const cached: CachedSetup = { term, fitAddon, ptyId: null, running: false, cleanupListeners: [] }
  setupCache.set(worktreePath, cached)
  return cached
}

/** Clean up setup panel terminals for a worktree (call on worktree removal) */
export function cleanupSetupPanel(worktreePath: string): void {
  const cached = setupCache.get(worktreePath)
  if (!cached) return
  // Remove any active IPC listeners
  for (const cleanup of cached.cleanupListeners) cleanup()
  cached.cleanupListeners.length = 0
  if (cached.ptyId) ipc.pty.kill(cached.ptyId)
  cached.term.dispose()
  setupCache.delete(worktreePath)
}

// ── Component ───────────────────────────────────────────────────────────────

export function SetupPanel({ worktreePath, projectId, hidden }: Props) {
  const { t } = useTranslation('right')
  const containerRef = useRef<HTMLDivElement>(null)
  const cachedRef = useRef<CachedSetup | null>(null)
  const worktreePathRef = useRef(worktreePath)
  const [running, setRunning] = useState(false)

  const project = useProjectsStore((s) => s.projects.find((p) => p.id === projectId))
  const setupScript = project?.settings?.setupScript?.trim() ?? ''
  const hasScripts = setupScript.length > 0

  // Run setup commands in the shadow terminal
  const runSetup = useCallback((commands: string[]) => {
    const cached = cachedRef.current
    if (!cached || cached.running) return

    cached.running = true
    setRunning(true)
    cached.term.clear()
    cached.term.write('\x1b[2m── Running setup scripts ──\x1b[0m\r\n\r\n')

    const combined = commands.join(' && ')

    ipc.pty.spawn(worktreePathRef.current).then((ptyId: string) => {
      if (cached.ptyId) ipc.pty.kill(cached.ptyId)
      cached.ptyId = ptyId

      // Clean up any previous listeners before registering new ones
      for (const cleanup of cached.cleanupListeners) cleanup()
      cached.cleanupListeners.length = 0

      const onData = ipc.pty.onData((id, data) => {
        if (id === ptyId) cached.term.write(data)
      })
      const onExit = ipc.pty.onExit((id) => {
        if (id === ptyId) {
          cached.term.write('\r\n\x1b[2m── Setup complete ──\x1b[0m\r\n')
          cached.running = false
          setRunning(false)
          cached.ptyId = null
          onData()
          onExit()
          cached.cleanupListeners.length = 0
        }
      })
      cached.cleanupListeners.push(onData, onExit)

      ipc.pty.write(ptyId, combined + '\n')
      // Send exit after the command so the PTY closes cleanly
      ipc.pty.write(ptyId, 'exit\n')
    }).catch((err: unknown) => {
      cached.term.write(`\x1b[31mError: ${err instanceof Error ? err.message : 'Failed to spawn'}\x1b[0m\r\n`)
      cached.running = false
      setRunning(false)
    })
  }, [])

  // Attach terminal to DOM
  useEffect(() => {
    worktreePathRef.current = worktreePath
    const cached = getOrCreateCache(worktreePath)
    cachedRef.current = cached

    const el = containerRef.current
    if (el) {
      // Clear any previous terminal DOM before attaching the new one
      while (el.firstChild) el.removeChild(el.firstChild)

      if (!cached.term.element) {
        cached.term.open(el)
      } else {
        el.appendChild(cached.term.element)
      }
      requestAnimationFrame(() => {
        try { cached.fitAddon.fit() } catch {}
      })
    }

    // Sync running state from cache
    setRunning(cached.running)

    return () => {
      // Detach terminal DOM but keep alive in cache
      if (el && cached.term.element && el.contains(cached.term.element)) {
        el.removeChild(cached.term.element)
      }
    }
  }, [worktreePath])

  // Fit on show
  useEffect(() => {
    if (hidden) return
    requestAnimationFrame(() => {
      try { cachedRef.current?.fitAddon.fit() } catch {}
    })
  }, [hidden])

  // Consume pending setup run from store
  useEffect(() => {
    const unsub = useUIStore.subscribe((state, prev) => {
      if (state.pendingSetupRun && !prev.pendingSetupRun) {
        const run = state.pendingSetupRun
        if (run.worktreePath === worktreePathRef.current) {
          runSetup(run.commands)
          useUIStore.getState().setPendingSetupRun(null)
        }
      }
    })
    return unsub
  }, [runSetup])

  // Re-theme
  useEffect(() => {
    let prevId = useUIStore.getState().activeThemeId
    const unsub = useUIStore.subscribe((state) => {
      if (state.activeThemeId !== prevId) {
        prevId = state.activeThemeId
        requestAnimationFrame(() => {
          for (const cached of setupCache.values()) {
            cached.term.options.theme = getTerminalTheme()
          }
        })
      }
    })
    return unsub
  }, [])

  if (!hasScripts) {
    return (
      <div className="setup-panel" style={{ display: hidden ? 'none' : undefined }}>
        <EmptyState
          icon={<IconWrench size={40} style={{ strokeWidth: 1.5 }} />}
          title={t('setupEmpty')}
          hint={t('setupEmptyHint')}
          action={
            <Button onClick={() => useUIStore.getState().openSettings(`project:${projectId}`)}>
              {t('setupConfigure')}
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div className="setup-panel" style={{ display: hidden ? 'none' : undefined }}>
      <div className="setup-panel-toolbar">
        <button
          className="setup-panel-rerun"
          onClick={() => runSetup(setupScript.split('\n').filter((l) => l.trim()))}
          disabled={running}
        >
          {running ? t('setupRunning') : t('setupRerun')}
        </button>
      </div>
      <div ref={containerRef} className="terminal-container" style={{ flex: 1 }} />
    </div>
  )
}
