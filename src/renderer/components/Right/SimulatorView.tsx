import { memo, useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { IPhoneMockup, AndroidMockup } from 'react-device-mockup'
import { useTranslation } from 'react-i18next'
import * as ipc from '@/lib/ipc'
import { useMjpegStream } from '@/hooks/useMjpegStream'
import { useGesture } from '@/hooks/useGesture'
import { DeviceToolbar } from './DeviceToolbar'
import { FrameworkToolbar } from './FrameworkToolbar'
import { simulatorRpc } from '@/lib/simulatorRpc'
import { useSessionsStore } from '@/store/sessions'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { IconExternalLink } from '@/components/shared/icons'

// ─── Types ───────────────────────────────────────────────────────────────────

interface SimulatorDevice {
  id: string
  name: string
  platform: string
  type: string
  version: string
  state: string
  model: string
}

type Phase = 'loading' | 'no-cli' | 'installing-cli' | 'device-list' | 'connecting' | 'streaming' | 'stream-lost' | 'error'

interface PlatformTools { xcode: boolean; androidSdk: boolean }

interface State {
  phase: Phase
  devices: SimulatorDevice[]
  selectedId: string | null
  screenSize: { width: number; height: number } | null
  error: string | null
  bootingId: string | null
  shuttingDownId: string | null
  /** True after at least one auto-setup attempt failed */
  cliInstallAttempted: boolean
  /** True when Homebrew is missing — blocks auto-install, shows brew guidance */
  needsBrew: boolean
  /** Detected platform toolchains (populated on first device load) */
  platformTools: PlatformTools | null
}

type Action =
  | { type: 'LOADING' }
  | { type: 'NO_CLI' }
  | { type: 'INSTALLING_CLI' }
  | { type: 'CLI_INSTALL_FAILED'; needsBrew: boolean }
  | { type: 'DEVICES_LOADED'; devices: SimulatorDevice[]; platformTools: PlatformTools }
  | { type: 'BOOTING'; id: string }
  | { type: 'BOOT_DONE' }
  | { type: 'SHUTTING_DOWN'; id: string }
  | { type: 'SHUTDOWN_DONE' }
  | { type: 'CONNECTING'; id: string }
  | { type: 'STREAM_STARTED'; screenSize: { width: number; height: number } }
  | { type: 'SCREEN_SIZE_UPDATED'; screenSize: { width: number; height: number } }
  | { type: 'STREAM_ENDED' }
  | { type: 'STREAM_LOST' }
  | { type: 'DISCONNECTED' }
  | { type: 'ERROR'; error: string }

const initialState: State = {
  phase: 'loading', devices: [], selectedId: null,
  screenSize: null, error: null, bootingId: null, shuttingDownId: null,
  cliInstallAttempted: false, needsBrew: false, platformTools: null,
}

const MOBILECLI_REPO = 'https://github.com/nicklama/mobilecli'
const HOMEBREW_URL = 'https://brew.sh'

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'LOADING': return { ...state, phase: 'loading', error: null }
    case 'NO_CLI': return { ...state, phase: 'no-cli' }
    case 'INSTALLING_CLI': return { ...state, phase: 'installing-cli' }
    case 'CLI_INSTALL_FAILED': return { ...state, phase: 'no-cli', cliInstallAttempted: true, needsBrew: action.needsBrew }
    case 'DEVICES_LOADED': return { ...state, phase: 'device-list', devices: action.devices, platformTools: action.platformTools, error: null }
    case 'BOOTING': return { ...state, bootingId: action.id }
    case 'BOOT_DONE': return { ...state, bootingId: null }
    case 'SHUTTING_DOWN': return { ...state, shuttingDownId: action.id }
    case 'SHUTDOWN_DONE': return { ...state, shuttingDownId: null }
    case 'CONNECTING': return { ...state, phase: 'connecting', selectedId: action.id }
    case 'STREAM_STARTED': return { ...state, phase: 'streaming', screenSize: action.screenSize }
    case 'SCREEN_SIZE_UPDATED': return { ...state, screenSize: action.screenSize }
    case 'STREAM_ENDED': return { ...state, phase: 'device-list', screenSize: null, selectedId: null }
    // Stream dropped unexpectedly — preserve selectedId so the overlay can offer reconnect
    case 'STREAM_LOST': return { ...state, phase: 'stream-lost', screenSize: null }
    case 'DISCONNECTED': return { ...state, phase: 'device-list', screenSize: null, selectedId: null }
    case 'ERROR': return { ...state, phase: 'error', error: action.error }
    default: return state
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

interface Props {
  isActive: boolean
  mobileFramework?: 'react-native' | 'flutter' | null
}

export const SimulatorView = memo(function SimulatorView({ isActive, mobileFramework }: Props) {
  const { t } = useTranslation('right')
  const [state, dispatch] = useReducer(reducer, initialState)

  const viewRef = useRef<HTMLDivElement>(null)
  const streamHeightRef = useRef(0)
  const [screenWidth, setScreenWidth] = useState(220)
  const screenWidthTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Recompute device mockup width whenever the panel resizes (debounced to avoid jank during drag)
  useEffect(() => {
    const el = viewRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth
      const h = el.clientHeight
      // iPhone island device: total height ≈ screenWidth * 2.4 (screen ratio + bezels)
      const fromH = (h - 80) / 2.4
      const fromW = w * 0.72
      const next = Math.max(160, Math.round(Math.min(fromH, fromW)))
      if (screenWidthTimerRef.current) clearTimeout(screenWidthTimerRef.current)
      screenWidthTimerRef.current = setTimeout(() => {
        screenWidthTimerRef.current = null
        setScreenWidth(next)
      }, 150)
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      if (screenWidthTimerRef.current) { clearTimeout(screenWidthTimerRef.current); screenWidthTimerRef.current = null }
    }
  }, [])

  // ─── Link device to active chat session ─────────────────────────────
  const activeSessionId = useSessionsStore((s) => s.activeSessionId)
  const connectedDeviceId = useSessionsStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId]?.connectedDeviceId : undefined,
  )
  const setConnectedDevice = useSessionsStore((s) => s.setConnectedDevice)

  const isLinked = connectedDeviceId === state.selectedId && !!state.selectedId
  const handleToggleLink = useCallback(() => {
    if (!activeSessionId || !state.selectedId) return
    setConnectedDevice(activeSessionId, isLinked ? undefined : state.selectedId)
  }, [activeSessionId, state.selectedId, isLinked, setConnectedDevice])

  // ─── Device actions (declared early so stream callbacks can reference them) ─

  /** Full load — shows spinner on first visit. */
  const loadDevices = useCallback(async () => {
    dispatch({ type: 'LOADING' })
    const hasCli = await ipc.simulator.checkCli()
    if (!hasCli) { dispatch({ type: 'NO_CLI' }); return }
    try {
      const [devices, platformTools] = await Promise.all([
        ipc.simulator.listDevices(),
        ipc.simulator.checkPlatformTools(),
      ])
      dispatch({ type: 'DEVICES_LOADED', devices: devices as SimulatorDevice[], platformTools })
    } catch {
      dispatch({ type: 'ERROR', error: t('simulatorStreamError') })
    }
  }, [t])

  /** Attempt brew install, then recheck. Detects missing Homebrew to show tailored guidance. */
  const installCli = useCallback(async () => {
    // Pre-check: is Homebrew even available?
    const hasBrew = await ipc.shell.checkTool('brew')
    if (!hasBrew) {
      dispatch({ type: 'CLI_INSTALL_FAILED', needsBrew: true })
      return
    }
    dispatch({ type: 'INSTALLING_CLI' })
    try { await ipc.shell.installTool('mobilecli') } catch { /* recheck below */ }
    const hasCli = await ipc.simulator.checkCli()
    if (hasCli) {
      loadDevices()
    } else {
      dispatch({ type: 'CLI_INSTALL_FAILED', needsBrew: false })
    }
  }, [loadDevices])

  /** Silent refresh — updates device list without flashing a spinner. */
  const refreshDevices = useCallback(async () => {
    try {
      const [devices, platformTools] = await Promise.all([
        ipc.simulator.listDevices(),
        ipc.simulator.checkPlatformTools(),
      ])
      dispatch({ type: 'DEVICES_LOADED', devices: devices as SimulatorDevice[], platformTools })
    } catch { /* keep current list on error */ }
  }, [])

  const onStreamEnded = useCallback((error?: string) => {
    if (error) {
      // Hard error (e.g. mobilecli crashed) — go to error phase
      dispatch({ type: 'ERROR', error })
      refreshDevices()
    } else {
      // Clean but unexpected drop (simulator killed, etc.) — stay on frozen frame
      dispatch({ type: 'STREAM_LOST' })
      refreshDevices() // update device list silently in background
    }
  }, [refreshDevices])
  const { canvasRef, imgSizeRef, start: startStream, stop: stopStream } = useMjpegStream(
    state.phase === 'streaming', onStreamEnded,
  )

  const sendGesture = useCallback((actions: Record<string, unknown>[]) => {
    if (state.selectedId) simulatorRpc('device.io.gesture', { deviceId: state.selectedId, actions })
  }, [state.selectedId])

  const { onMouseDown, onMouseMove, onMouseUp } = useGesture(
    canvasRef, imgSizeRef, state.screenSize, sendGesture,
  )

  useEffect(() => {
    if (!isActive) return
    // Don't disrupt an active or recovering stream
    if (state.phase === 'streaming' || state.phase === 'connecting' || state.phase === 'stream-lost') return
    // Already loaded — silent refresh avoids the loading spinner on tab/project switch-back
    if (state.phase === 'device-list' && state.devices.length > 0) { refreshDevices(); return }
    loadDevices()
  }, [isActive]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleBoot = useCallback(async (id: string) => {
    dispatch({ type: 'BOOTING', id })
    try {
      await ipc.simulator.boot(id)
    } catch (err) {
      console.error('[SimulatorView] Boot failed:', err)
    }
    dispatch({ type: 'BOOT_DONE' })
    refreshDevices()
  }, [refreshDevices])

  const handleShutdown = useCallback(async (id: string) => {
    dispatch({ type: 'SHUTTING_DOWN', id })
    try { await ipc.simulator.shutdown(id) } catch { /* ignore */ }
    dispatch({ type: 'SHUTDOWN_DONE' })
    refreshDevices()
  }, [refreshDevices])

  const handleConnect = useCallback(async (id: string) => {
    console.log('[SimulatorView] handleConnect start', { id })
    dispatch({ type: 'CONNECTING', id })
    try {
      // Measure the view so the server sends frames sized to fit
      const displayHeight = viewRef.current?.clientHeight ?? undefined
      streamHeightRef.current = displayHeight ?? 0
      console.log('[SimulatorView] Creating stream session...', { id, displayHeight })
      const { streamUrl, screenSize } = await ipc.simulator.createStreamSession(id, displayHeight)
      console.log('[SimulatorView] Stream session created', { streamUrl, screenSize })
      dispatch({ type: 'STREAM_STARTED', screenSize })
      startStream(streamUrl)
      // Hide the native Simulator window — we're streaming it in-app
      const device = state.devices.find((d) => d.id === id)
      if (device?.platform === 'ios') {
        ipc.simulator.hideWindow().catch(() => {})
      }
    } catch (err) {
      console.error('[SimulatorView] handleConnect FAILED:', err)
      dispatch({ type: 'ERROR', error: t('simulatorStreamError') })
    }
  }, [t, startStream, state.devices])

  // Silent reconnect during resize — keeps canvas visible (frozen last frame) instead of flashing the spinner
  const handleReconnect = useCallback(async (id: string) => {
    try {
      const displayHeight = viewRef.current?.clientHeight ?? undefined
      streamHeightRef.current = displayHeight ?? 0
      const { streamUrl, screenSize } = await ipc.simulator.createStreamSession(id, displayHeight)
      dispatch({ type: 'SCREEN_SIZE_UPDATED', screenSize })
      startStream(streamUrl)
    } catch {
      dispatch({ type: 'ERROR', error: t('simulatorStreamError') })
    }
  }, [t, startStream])

  const handleDisconnect = useCallback(() => {
    stopStream()
    dispatch({ type: 'DISCONNECTED' })
  }, [stopStream])

  const handleDisconnectAndShutdown = useCallback(() => {
    const id = state.selectedId
    stopStream()
    dispatch({ type: 'DISCONNECTED' })
    if (id) handleShutdown(id)
  }, [state.selectedId, stopStream, handleShutdown])

  // ─── Reconnect on significant resize ─────────────────────────────────

  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const el = viewRef.current
    if (!el || state.phase !== 'streaming' || !state.selectedId) return

    const id = state.selectedId
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height ?? 0
      if (!h || !streamHeightRef.current) return
      const ratio = h / streamHeightRef.current
      // Only reconnect if size changed by >30% — avoids churn during drag
      if (ratio > 0.7 && ratio < 1.3) return

      // Debounce: wait 500ms after last resize event, then reconnect silently
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null
        stopStream()
        handleReconnect(id)
      }, 500)
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null }
    }
  }, [state.phase, state.selectedId, stopStream, handleReconnect])

  // ─── Keyboard forwarding (direct RPC, no batching needed) ──────────────

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (!state.selectedId) return
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) return
    e.preventDefault()

    let text: string | null = null
    if (e.key === 'Enter') text = '\n'
    else if (e.key === 'Backspace') text = '\b'
    else if (e.key.length === 1) text = e.key

    if (text) simulatorRpc('device.io.text', { deviceId: state.selectedId, text })
  }, [state.selectedId])

  // ─── Render ──────────────────────────────────────────────────────────────

  const renderContent = () => {
    if (state.phase === 'loading') {
      return <div className="simulator-centered"><span className="simulator-loading-text">{t('simulatorLoading')}</span></div>
    }
    if (state.phase === 'no-cli') {
      // Homebrew missing → explain what to do, don't offer the auto-install button
      if (state.needsBrew) {
        return (
          <EmptyState
            title={t('simulatorCliMissing')}
            hint={t('simulatorCliNeedsBrew')}
            action={
              <div className="simulator-cli-actions">
                <Button size="sm" onClick={() => ipc.shell.openExternal(HOMEBREW_URL)}>
                  Homebrew <IconExternalLink size={10} />
                </Button>
                <button className="simulator-cli-docs-link" onClick={() => ipc.shell.openExternal(MOBILECLI_REPO)}>
                  {t('simulatorCliManual')} <IconExternalLink size={10} />
                </button>
              </div>
            }
          />
        )
      }
      return (
        <EmptyState
          title={t('simulatorCliMissing')}
          hint={state.cliInstallAttempted ? undefined : t('simulatorCliMissingHint')}
          action={
            <div className="simulator-cli-actions">
              <Button variant="primary" size="sm" onClick={installCli}>
                {state.cliInstallAttempted ? t('simulatorRefresh') : t('simulatorCliInstall')}
              </Button>
              {state.cliInstallAttempted && (
                <button className="simulator-cli-docs-link" onClick={() => ipc.shell.openExternal(MOBILECLI_REPO)}>
                  {t('simulatorCliManual')} <IconExternalLink size={10} />
                </button>
              )}
            </div>
          }
        />
      )
    }
    if (state.phase === 'installing-cli') {
      return (
        <EmptyState
          title={t('simulatorCliInstalling')}
          action={<Spinner size="sm" />}
        />
      )
    }
    if (state.phase === 'error') {
      return (
        <div className="simulator-centered">
          <span className="simulator-error-text">{state.error}</span>
          <button className="simulator-action-btn" onClick={loadDevices}>{t('simulatorRefresh')}</button>
        </div>
      )
    }
    if (state.phase === 'connecting') {
      return <div className="simulator-centered"><span className="simulator-loading-text">{t('simulatorConnecting')}</span></div>
    }

    if (state.phase === 'streaming' || state.phase === 'stream-lost') {
      const isLost = state.phase === 'stream-lost'
      const device = state.devices.find((d) => d.id === state.selectedId)
      const isIos = (device?.platform ?? 'ios') === 'ios'
      const screenType = isIos ? iphoneScreenType(device?.name ?? '') : undefined
      const canvasEl = (
        <canvas
          ref={canvasRef}
          className="simulator-video"
          tabIndex={isLost ? -1 : 0}
          style={isLost ? { opacity: 0.25, pointerEvents: 'none' } : undefined}
          onMouseDown={isLost ? undefined : onMouseDown}
          onMouseMove={isLost ? undefined : onMouseMove}
          onMouseUp={isLost ? undefined : onMouseUp}
          onKeyDown={isLost ? undefined : handleKeyDown}
        />
      )
      return (
        <>
          <div className="simulator-header" data-tour="simulator-stream-header">
            <span className="simulator-header-name">{device?.name ?? 'Device'}</span>
            {!isLost && (
              <div className="simulator-header-actions">
                <button
                  className={`simulator-action-btn ${isLinked ? 'simulator-linked-btn' : 'simulator-link-btn'}`}
                  onClick={handleToggleLink}
                  disabled={!activeSessionId}
                  title={isLinked ? t('simulatorUnlinkChat') : t('simulatorLinkChat')}
                >
                  {isLinked ? t('simulatorLinked') : t('simulatorLinkChat')}
                </button>
                <button className="simulator-action-btn simulator-disconnect-btn" onClick={handleDisconnect}>
                  {t('simulatorDisconnect')}
                </button>
                <button className="simulator-action-btn simulator-shutdown-btn" onClick={handleDisconnectAndShutdown}>
                  {t('simulatorShutdown')}
                </button>
              </div>
            )}
          </div>
          {!isLost && mobileFramework && (
            <FrameworkToolbar deviceId={state.selectedId!} platform={device?.platform ?? 'ios'} framework={mobileFramework} />
          )}
          <div className="simulator-stream-container" style={{ position: 'relative' }}>
            {isIos ? (
              <IPhoneMockup screenWidth={screenWidth} screenType={screenType} frameColor="#1c1c1e" hideStatusBar hideNavBar>
                {canvasEl}
              </IPhoneMockup>
            ) : (
              <AndroidMockup screenWidth={screenWidth} navBar="swipe" frameColor="#1c1c1e" hideStatusBar hideNavBar>
                {canvasEl}
              </AndroidMockup>
            )}
            {isLost && (
              <div className="simulator-stream-lost-overlay">
                <span className="simulator-stream-lost-msg">{t('simulatorStreamLost')}</span>
                <div className="simulator-header-actions">
                  <button className="simulator-action-btn simulator-connect-btn" onClick={() => handleConnect(state.selectedId!)}>
                    {t('simulatorReconnect')}
                  </button>
                  <button className="simulator-action-btn" onClick={() => { dispatch({ type: 'STREAM_ENDED' }); refreshDevices() }}>
                    {t('simulatorDisconnect')}
                  </button>
                </div>
              </div>
            )}
          </div>
          {!isLost && <DeviceToolbar deviceId={state.selectedId!} platform={device?.platform ?? 'ios'} />}
        </>
      )
    }

    const grouped = groupByPlatformVersion(state.devices)
    return (
      <>
        <div className="simulator-list-header" data-tour="simulator-header">
          <span className="simulator-list-title">{t('simulatorTab')}</span>
          <button className="simulator-action-btn" onClick={loadDevices}>{t('simulatorRefresh')}</button>
        </div>
        {state.devices.length === 0 ? (
          <NoDevicesState platformTools={state.platformTools} />
        ) : (
          <div className="simulator-device-list" data-tour="simulator-devices">
            {grouped.map(([group, devices]) => (
              <div key={group} className="simulator-device-group">
                <div className="simulator-runtime-header">{group}</div>
                {devices.map((device) => (
                  <DeviceRow key={device.id} device={device}
                    booting={state.bootingId === device.id}
                    shuttingDown={state.shuttingDownId === device.id}
                    onBoot={handleBoot} onConnect={handleConnect} onShutdown={handleShutdown} />
                ))}
              </div>
            ))}
          </div>
        )}
      </>
    )
  }

  return <div ref={viewRef} className="simulator-view" data-tour="simulator-view">{renderContent()}</div>
})

// ─── No Devices — platform-aware empty state ────────────────────────────────

const XCODE_URL = 'https://apps.apple.com/app/xcode/id497799835'
const ANDROID_STUDIO_URL = 'https://developer.android.com/studio'

function NoDevicesState({ platformTools }: { platformTools: PlatformTools | null }) {
  const { t } = useTranslation('right')
  const pt = platformTools

  // Pick the most specific hint based on what's missing
  let hint = t('simulatorNoDevicesHint') // generic fallback
  if (pt && !pt.xcode && !pt.androidSdk) hint = t('simulatorNoDevicesHintNone')
  else if (pt && !pt.xcode) hint = t('simulatorNoDevicesHintNoXcode')
  else if (pt && !pt.androidSdk) hint = t('simulatorNoDevicesHintNoAndroid')

  const missingXcode = pt && !pt.xcode
  const missingAndroid = pt && !pt.androidSdk

  return (
    <EmptyState
      title={t('simulatorNoDevices')}
      hint={hint}
      action={
        (missingXcode || missingAndroid) ? (
          <div className="simulator-cli-actions">
            {missingXcode && (
              <Button size="sm" onClick={() => ipc.shell.openExternal(XCODE_URL)}>
                {t('simulatorOpenXcode')}
              </Button>
            )}
            {missingAndroid && (
              <Button size="sm" onClick={() => ipc.shell.openExternal(ANDROID_STUDIO_URL)}>
                {t('simulatorOpenAndroidStudio')}
              </Button>
            )}
          </div>
        ) : undefined
      }
    />
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Maps a device name to the correct IPhoneMockup screenType:
//   "island"  — iPhone 15 Pro / 16 and later (Dynamic Island)
//   "notch"   — iPhone X through 14 (notch)
//   "legacy"  — iPhone SE / 8 and earlier (home button, no notch)
function iphoneScreenType(name: string): 'island' | 'notch' | 'legacy' {
  // Dynamic Island: iPhone 15 Pro, 15 Pro Max, 16, 16 Plus, 16 Pro, 16 Pro Max, and beyond
  if (/iPhone 1[5-9] Pro|iPhone [2-9]\d Pro|iPhone 1[6-9]( Plus| Pro)?|iPhone [2-9]\d( Plus| Pro)?/i.test(name)) {
    return 'island'
  }
  // Notch era: iPhone X, XS, XR, 11, 12, 13, 14 (and their variants)
  if (/iPhone (X|XS|XR|11|12|13|14)/i.test(name)) {
    return 'notch'
  }
  // Legacy: SE, 8, 7, 6, 5 — home button devices
  return 'legacy'
}

function groupByPlatformVersion(devices: SimulatorDevice[]): [string, SimulatorDevice[]][] {
  const map = new Map<string, SimulatorDevice[]>()
  for (const d of devices) {
    const label = `${d.platform === 'ios' ? 'iOS' : 'Android'} ${d.version}`
    const list = map.get(label) ?? []
    list.push(d)
    map.set(label, list)
  }
  return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]))
}

const DeviceRow = memo(function DeviceRow({
  device, booting, shuttingDown, onBoot, onConnect, onShutdown,
}: {
  device: SimulatorDevice; booting: boolean; shuttingDown: boolean
  onBoot: (id: string) => void; onConnect: (id: string) => void; onShutdown: (id: string) => void
}) {
  const { t } = useTranslation('right')
  const isOnline = device.state === 'online'
  return (
    <div className="simulator-device-item">
      <div className="simulator-device-info">
        <span className="simulator-device-name">{device.name}</span>
        <span className={`simulator-device-state ${isOnline ? 'booted' : ''}`}>
          {isOnline ? t('simulatorOnline') : t('simulatorOffline')}
        </span>
      </div>
      <div className="simulator-device-actions">
        {isOnline ? (
          <>
            <button className="simulator-action-btn simulator-connect-btn" onClick={() => onConnect(device.id)}>
              {t('simulatorConnect')}
            </button>
            <button className="simulator-action-btn simulator-shutdown-btn" onClick={() => onShutdown(device.id)} disabled={shuttingDown}>
              {shuttingDown ? '…' : t('simulatorShutdown')}
            </button>
          </>
        ) : (
          <button className="simulator-action-btn" onClick={() => onBoot(device.id)} disabled={booting}>
            {booting ? t('simulatorBooting') : t('simulatorBoot')}
          </button>
        )}
      </div>
    </div>
  )
})
