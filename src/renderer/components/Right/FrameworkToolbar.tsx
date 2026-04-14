import { memo, useCallback, useReducer } from 'react'
import { useTranslation } from 'react-i18next'
import * as ipc from '@/lib/ipc'

interface Props {
  deviceId: string
  platform: string // 'ios' | 'android'
  framework: 'react-native' | 'flutter'
}

interface State {
  activeAction: string | null
}

type Action =
  | { type: 'START'; action: string }
  | { type: 'DONE' }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'START': return { activeAction: action.action }
    case 'DONE': return { activeAction: null }
    default: return state
  }
}

export const FrameworkToolbar = memo(function FrameworkToolbar({ deviceId, platform, framework }: Props) {
  const { t } = useTranslation('right')
  const [state, dispatch] = useReducer(reducer, { activeAction: null })

  const runAction = useCallback(async (name: string, fn: () => Promise<void>) => {
    dispatch({ type: 'START', action: name })
    try {
      await fn()
    } catch (err) {
      console.error(`[FrameworkToolbar] ${name} failed:`, err)
    } finally {
      dispatch({ type: 'DONE' })
    }
  }, [])

  // ─── React Native actions ──────────────────────────────────────────────

  const handleRnReload = useCallback(() => {
    runAction('reload', () => ipc.simulator.metroReload())
  }, [runAction])

  const handleRnDevMenu = useCallback(() => {
    runAction('devMenu', async () => {
      if (platform === 'ios') {
        await ipc.simulator.sendKeyCombo(deviceId, 'ios', 'cmd+d')
      } else {
        await ipc.simulator.sendKeyCombo(deviceId, 'android', '82')
      }
    })
  }, [deviceId, platform, runAction])

  const handleRnDevTools = useCallback(() => {
    ipc.shell.openExternal('http://localhost:8081')
  }, [])

  // ─── Flutter actions ───────────────────────────────────────────────────

  const handleFlutterHotReload = useCallback(() => {
    runAction('hotReload', () => ipc.simulator.flutterSignal('SIGUSR1'))
  }, [runAction])

  const handleFlutterHotRestart = useCallback(() => {
    runAction('hotRestart', () => ipc.simulator.flutterSignal('SIGUSR2'))
  }, [runAction])

  const handleFlutterDevTools = useCallback(() => {
    ipc.shell.openExternal('http://localhost:9100')
  }, [])

  // ─── Render ────────────────────────────────────────────────────────────

  const isRn = framework === 'react-native'
  const badgeClass = isRn ? 'framework-badge-rn' : 'framework-badge-flutter'

  return (
    <div className="framework-toolbar">
      <span className={`framework-badge ${badgeClass}`}>
        {isRn ? t('frameworkReactNative') : t('frameworkFlutter')}
      </span>

      <div className="device-toolbar-sep" />

      {isRn ? (
        <>
          <button className="device-toolbar-btn" onClick={handleRnReload}
            disabled={state.activeAction === 'reload'} title={t('frameworkReload')}>
            <RnReloadIcon />
          </button>
          <button className="device-toolbar-btn" onClick={handleRnDevMenu}
            disabled={state.activeAction === 'devMenu'} title={t('frameworkDevMenu')}>
            <RnDevMenuIcon />
          </button>
          <button className="device-toolbar-btn" onClick={handleRnDevTools}
            title={t('frameworkOpenDevTools')}>
            <RnDevToolsIcon />
          </button>
        </>
      ) : (
        <>
          <button className="device-toolbar-btn" onClick={handleFlutterHotReload}
            disabled={state.activeAction === 'hotReload'} title={t('frameworkHotReload')}>
            <FlutterHotReloadIcon />
          </button>
          <button className="device-toolbar-btn" onClick={handleFlutterHotRestart}
            disabled={state.activeAction === 'hotRestart'} title={t('frameworkHotRestart')}>
            <FlutterHotRestartIcon />
          </button>
          <button className="device-toolbar-btn" onClick={handleFlutterDevTools}
            title={t('frameworkOpenDevTools')}>
            <FlutterDevToolsIcon />
          </button>
        </>
      )}
    </div>
  )
})

// ─── React Native icons (16×16) ───────────────────────────────────────────────

/** Bidirectional circular arrows — Metro bundle reload */
function RnReloadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 5A6 6 0 0 1 13 4.5" />
      <path d="M13 2v3h-3" />
      <path d="M13.5 11A6 6 0 0 1 3 11.5" />
      <path d="M3 14v-3h3" />
    </svg>
  )
}

/** Vertical sliders with offset handles — developer settings / dev menu */
function RnDevMenuIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="3" x2="3" y2="13" />
      <line x1="8" y1="3" x2="8" y2="13" />
      <line x1="13" y1="3" x2="13" y2="13" />
      <line x1="1.5" y1="6" x2="4.5" y2="6" />
      <line x1="6.5" y1="9.5" x2="9.5" y2="9.5" />
      <line x1="11.5" y1="4.5" x2="14.5" y2="4.5" />
    </svg>
  )
}

/** Browser window with traffic lights — opens Metro DevTools in browser */
function RnDevToolsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1.5" y="2.5" width="13" height="10" rx="1.5" />
      <line x1="1.5" y1="6" x2="14.5" y2="6" />
      <circle cx="4" cy="4.25" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="6.5" cy="4.25" r="0.75" fill="currentColor" stroke="none" />
      <path d="M5.5 9.5l2 1.5 2.5-2" />
    </svg>
  )
}

// ─── Flutter icons (16×16) ────────────────────────────────────────────────────

/** Lightning bolt — Flutter's iconic hot reload symbol */
function FlutterHotReloadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 2L4.5 8.5H8L6.5 14l5-6.5H8L9.5 2z" />
    </svg>
  )
}

/** Power cycle — full widget tree restart, state is discarded */
function FlutterHotRestartIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5.5 3.5A5.5 5.5 0 1 0 10.5 3.5" />
      <line x1="8" y1="1.5" x2="8" y2="6.5" />
    </svg>
  )
}

/** Magnifier with crosshair — inspect / Flutter DevTools */
function FlutterDevToolsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6.5" cy="6.5" r="4" />
      <line x1="9.5" y1="9.5" x2="13.5" y2="13.5" />
      <line x1="5" y1="6.5" x2="8" y2="6.5" />
      <line x1="6.5" y1="5" x2="6.5" y2="8" />
    </svg>
  )
}
