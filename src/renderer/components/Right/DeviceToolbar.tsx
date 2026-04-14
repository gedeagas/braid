import { memo, useCallback, useReducer } from 'react'
import { useTranslation } from 'react-i18next'
import * as ipc from '@/lib/ipc'
import { simulatorRpc } from '@/lib/simulatorRpc'

interface Props {
  deviceId: string
  platform: string
}

interface State {
  orientation: 'portrait' | 'landscape'
  screenshotting: boolean
}

type Action =
  | { type: 'SET_ORIENTATION'; orientation: 'portrait' | 'landscape' }
  | { type: 'SCREENSHOT_START' }
  | { type: 'SCREENSHOT_DONE' }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SET_ORIENTATION': return { ...state, orientation: action.orientation }
    case 'SCREENSHOT_START': return { ...state, screenshotting: true }
    case 'SCREENSHOT_DONE': return { ...state, screenshotting: false }
    default: return state
  }
}

/**
 * Toolbar shown below the device stream with Home, Back, Screenshot,
 * Volume, and Rotate buttons. Calls mobilecli `device.io.button` /
 * `device.screenshot` / `device.io.orientation.set` RPCs.
 */
export const DeviceToolbar = memo(function DeviceToolbar({ deviceId, platform }: Props) {
  const { t } = useTranslation('right')
  const [state, dispatch] = useReducer(reducer, { orientation: 'portrait', screenshotting: false })
  const isAndroid = platform === 'android'

  const press = useCallback((button: string) => {
    simulatorRpc('device.io.button', { deviceId, button })
  }, [deviceId])

  const handleScreenshot = useCallback(async () => {
    dispatch({ type: 'SCREENSHOT_START' })
    try {
      const b64 = await ipc.simulator.screenshot(deviceId)
      if (b64) {
        // Download as PNG
        const a = document.createElement('a')
        a.href = `data:image/png;base64,${b64}`
        a.download = `screenshot-${Date.now()}.png`
        a.click()
      }
    } finally {
      dispatch({ type: 'SCREENSHOT_DONE' })
    }
  }, [deviceId])

  const handleRotate = useCallback(async () => {
    const next = state.orientation === 'portrait' ? 'landscape' : 'portrait'
    try {
      await simulatorRpc('device.io.orientation.set', { deviceId, orientation: next })
      dispatch({ type: 'SET_ORIENTATION', orientation: next })
    } catch { /* ignore */ }
  }, [deviceId, state.orientation])

  return (
    <div className="device-toolbar">
      {/* Back — Android only */}
      {isAndroid && (
        <button className="device-toolbar-btn" onClick={() => press('BACK')} title={t('simulatorBtnBack')}>
          <BackIcon />
        </button>
      )}

      {/* Home */}
      <button className="device-toolbar-btn" onClick={() => press('HOME')} title={t('simulatorBtnHome')}>
        <HomeIcon />
      </button>

      {/* App Switcher — Android only */}
      {isAndroid && (
        <button className="device-toolbar-btn" onClick={() => press('APP_SWITCH')} title={t('simulatorBtnAppSwitch')}>
          <AppSwitchIcon />
        </button>
      )}

      <div className="device-toolbar-sep" />

      {/* Volume */}
      <button className="device-toolbar-btn" onClick={() => press('VOLUME_UP')} title={t('simulatorBtnVolUp')}>
        <VolUpIcon />
      </button>
      <button className="device-toolbar-btn" onClick={() => press('VOLUME_DOWN')} title={t('simulatorBtnVolDown')}>
        <VolDownIcon />
      </button>

      <div className="device-toolbar-sep" />

      {/* Power */}
      <button className="device-toolbar-btn" onClick={() => press('POWER')} title={t('simulatorBtnPower')}>
        <PowerIcon />
      </button>

      {/* Rotate */}
      <button className="device-toolbar-btn" onClick={handleRotate} title={t('simulatorBtnRotate')}>
        <RotateIcon />
      </button>

      {/* Screenshot */}
      <button className="device-toolbar-btn" onClick={handleScreenshot}
        disabled={state.screenshotting} title={t('simulatorBtnScreenshot')}>
        <ScreenshotIcon />
      </button>
    </div>
  )
})

// ─── Tiny SVG icons (16×16) ──────────────────────────────────────────────────
// Kept inline since they're toolbar-specific and very small.

function HomeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6.5 8 2.5l5 4v6.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
      <path d="M6 13V9h4v4" />
    </svg>
  )
}

function BackIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 3 5 8l5 5" />
    </svg>
  )
}

function AppSwitchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="10" height="10" rx="1" />
    </svg>
  )
}

function VolUpIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6.5h2l3-3v9l-3-3H3z" />
      <path d="M12 5a4.5 4.5 0 0 1 0 6" />
    </svg>
  )
}

function VolDownIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6.5h2l3-3v9l-3-3H3z" />
    </svg>
  )
}

function PowerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2v5" />
      <path d="M4.5 4.2a5.5 5.5 0 1 0 7 0" />
    </svg>
  )
}

function RotateIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 5A6 6 0 0 1 13 4.5" />
      <path d="M13 2v3h-3" />
      <path d="M13.5 11A6 6 0 0 1 3 11.5" />
      <path d="M3 14v-3h3" />
    </svg>
  )
}

function ScreenshotIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <circle cx="8" cy="8" r="2.5" />
      <path d="M5.5 3V2" />
      <path d="M10.5 3V2" />
    </svg>
  )
}
