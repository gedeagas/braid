import { useReducer, useCallback, useEffect, useRef, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import QRCode from 'qrcode'
import { useUIStore } from '@/store/ui'
import type { MobileNgrokRegion } from '@/store/ui/settings'
import { Toggle } from '@/components/shared/Toggle'
import { SegmentedControl } from '@/components/shared/SegmentedControl'
import { Button } from '@/components/ui'
import { StatusDot } from '@/components/ui/StatusDot'
import {
  IconTerminal,
  IconInbox,
  IconGitBranch,
  IconSmartphone,
  IconLock,
  IconSparkle,
  IconCheckmark,
  IconCopy,
  IconRefresh,
  IconGlobe,
  type IconProps,
} from '@/components/shared/icons'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import * as ipc from '@/lib/ipc'

interface MobileDevice {
  id: string
  name: string
  publicKey: string
  pairedAt: number
  lastSeenAt: number
}

interface PairingOffer {
  endpoint: string
  token: string
  serverPublicKey: string
  transport?: PairingTransport
}

type PairingTransport = 'lan' | 'ngrok'

interface NgrokTunnelStatus {
  running: boolean
  port: number | null
  url: string | null
  endpoint: string | null
  startedAt: number | null
  error: string | null
}

interface MobileState {
  devices: MobileDevice[]
  pairingTransport: PairingTransport
  pairingOffer: PairingOffer | null
  pairingPayload: string | null
  qrDataUrl: string | null
  ngrokTunnel: NgrokTunnelStatus
  serverRunning: boolean
  serverPort: number | null
  connectedDevices: Array<{ id: string; name: string; connectedAt: number }>
  // Set when a phone just consumed the one-time pairing QR, so we replace the
  // (now-stale) QR with a success state instead of leaving a scannable dead code.
  justPaired: { name: string } | null
  loading: boolean
  error: string | null
}

type MobileAction =
  | { type: 'SET_STATUS'; running: boolean; port: number | null; connectedDevices: Array<{ id: string; name: string; connectedAt: number }> }
  | { type: 'SET_DEVICES'; devices: MobileDevice[] }
  | { type: 'SET_TRANSPORT'; transport: PairingTransport }
  | { type: 'SET_PAIRING'; offer: PairingOffer | null; pairingPayload: string | null; qrDataUrl: string | null }
  | { type: 'SET_NGROK_TUNNEL'; tunnel: NgrokTunnelStatus }
  | { type: 'SET_JUST_PAIRED'; device: { name: string } | null }
  | { type: 'SET_LOADING'; loading: boolean }
  | { type: 'SET_ERROR'; error: string | null }

function reducer(state: MobileState, action: MobileAction): MobileState {
  switch (action.type) {
    case 'SET_STATUS':
      return { ...state, serverRunning: action.running, serverPort: action.port, connectedDevices: action.connectedDevices }
    case 'SET_DEVICES':
      return { ...state, devices: action.devices }
    case 'SET_TRANSPORT':
      return { ...state, pairingTransport: action.transport }
    case 'SET_PAIRING':
      // Generating or clearing a QR always exits the just-paired success state.
      return { ...state, pairingOffer: action.offer, pairingPayload: action.pairingPayload, qrDataUrl: action.qrDataUrl, justPaired: null }
    case 'SET_NGROK_TUNNEL':
      return { ...state, ngrokTunnel: action.tunnel }
    case 'SET_JUST_PAIRED':
      // A successful pairing consumes the one-time QR; drop it as we show success.
      return { ...state, justPaired: action.device, pairingOffer: null, pairingPayload: null, qrDataUrl: null }
    case 'SET_LOADING':
      return { ...state, loading: action.loading }
    case 'SET_ERROR':
      return { ...state, error: action.error }
  }
}

/** Capabilities surfaced once a phone is paired - drives the preview panel. */
const FEATURES: Array<{ key: string; Icon: (props: IconProps) => ReactElement }> = [
  { key: 'liveTerminals', Icon: IconTerminal },
  { key: 'pushNotifs', Icon: IconInbox },
  { key: 'gitWorktrees', Icon: IconGitBranch },
]

export function SettingsMobile() {
  const { t } = useTranslation('settings')
  const setMobileServerEnabled = useUIStore((s) => s.setMobileServerEnabled)
  const mobileNgrokRegion = useUIStore((s) => s.mobileNgrokRegion)
  const setMobileNgrokRegion = useUIStore((s) => s.setMobileNgrokRegion)
  const confirmingRef = useRef<string | null>(null)
  // Device ids already paired when the current QR was generated; used to detect
  // a brand-new pairing while the QR is on screen.
  const pairBaselineRef = useRef<Set<string>>(new Set())
  const [, forceRender] = useReducer((x: number) => x + 1, 0)

  const [state, dispatch] = useReducer(reducer, {
    devices: [],
    pairingTransport: 'lan',
    pairingOffer: null,
    pairingPayload: null,
    qrDataUrl: null,
    ngrokTunnel: { running: false, port: null, url: null, endpoint: null, startedAt: null, error: null },
    serverRunning: false,
    serverPort: null,
    connectedDevices: [],
    justPaired: null,
    loading: false,
    error: null,
  })

  const { copied: copiedCode, handleCopy: handleCopyCode } = useCopyToClipboard(state.pairingPayload ?? '')
  const { copied: copiedEndpoint, handleCopy: handleCopyEndpoint } = useCopyToClipboard(state.ngrokTunnel.endpoint ?? '')

  const loadData = useCallback(async () => {
    // Settle each call independently. A single failing IPC (e.g. ngrok status
    // while a tunnel is mid-start) must NOT blank the device list / connected
    // indicators - which is exactly what an all-or-nothing Promise.all in a
    // swallowing try/catch did, leaving a freshly paired phone invisible on the
    // desktop until a full reconnect.
    const [status, devices, tunnel] = await Promise.allSettled([
      ipc.mobile.getStatus(),
      ipc.mobile.getDevices(),
      ipc.mobile.getNgrokTunnelStatus(),
    ])
    if (status.status === 'fulfilled') {
      dispatch({ type: 'SET_STATUS', running: status.value.running, port: status.value.port, connectedDevices: status.value.connectedDevices })
    }
    if (devices.status === 'fulfilled') {
      dispatch({ type: 'SET_DEVICES', devices: devices.value as MobileDevice[] })
    }
    if (tunnel.status === 'fulfilled') {
      dispatch({ type: 'SET_NGROK_TUNNEL', tunnel: tunnel.value as NgrokTunnelStatus })
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Live device events: refresh the list/connected indicators, and when a phone
  // just consumed the one-time pairing QR, swap it for a success state so no one
  // scans a now-dead code.
  useEffect(() => {
    const offConnected = ipc.mobile.onDeviceConnected((info) => {
      void loadData()
      if (info.isNewPairing) dispatch({ type: 'SET_JUST_PAIRED', device: { name: info.name } })
    })
    const offDisconnected = ipc.mobile.onDeviceDisconnected(() => { void loadData() })
    return () => {
      offConnected()
      offDisconnected()
    }
  }, [loadData])

  // Reliable backbone behind the push 'mobile:deviceConnected' event: while the
  // server is up, poll status/devices so the connected indicators and paired
  // list self-heal even if that event is missed (a stale preload after a
  // hot-reload, or a first-pair race). Previously this was gated on the QR being
  // on screen, so a missed event left a freshly paired - and on the phone,
  // solidly connected - device invisible on the desktop until a full reconnect.
  // Only runs while this page is mounted; the cleanup clears it on unmount.
  useEffect(() => {
    if (!state.serverRunning) return
    const timer = setInterval(() => { void loadData() }, 2000)
    return () => clearInterval(timer)
  }, [state.serverRunning, loadData])

  // When the device list gains an entry that wasn't paired when this QR was
  // generated, that's the scan we were waiting for - swap the QR for success.
  useEffect(() => {
    if (!state.qrDataUrl) return
    const newDevice = state.devices.find((d) => d.publicKey && !pairBaselineRef.current.has(d.id))
    if (newDevice) dispatch({ type: 'SET_JUST_PAIRED', device: { name: newDevice.name } })
  }, [state.devices, state.qrDataUrl])

  const handleToggle = async (enabled: boolean) => {
    dispatch({ type: 'SET_LOADING', loading: true })
    dispatch({ type: 'SET_ERROR', error: null })
    try {
      if (enabled) {
        await ipc.mobile.start()
      } else {
        await ipc.mobile.stop()
        dispatch({ type: 'SET_PAIRING', offer: null, pairingPayload: null, qrDataUrl: null })
        dispatch({ type: 'SET_NGROK_TUNNEL', tunnel: { running: false, port: null, url: null, endpoint: null, startedAt: null, error: null } })
      }
      setMobileServerEnabled(enabled)
      await loadData()
    } catch (err) {
      dispatch({ type: 'SET_ERROR', error: err instanceof Error ? err.message : String(err) })
    } finally {
      dispatch({ type: 'SET_LOADING', loading: false })
    }
  }

  const handleGeneratePairing = async () => {
    dispatch({ type: 'SET_LOADING', loading: true })
    dispatch({ type: 'SET_ERROR', error: null })
    try {
      if (state.pairingTransport === 'ngrok') {
        const tunnel = await ipc.mobile.startNgrokTunnel()
        dispatch({ type: 'SET_NGROK_TUNNEL', tunnel: tunnel as NgrokTunnelStatus })
      }
      const offer = await ipc.mobile.generatePairingOffer({ transport: state.pairingTransport })
      if (!offer) return
      const payload = btoa(JSON.stringify(offer))
      const qrDataUrl = await QRCode.toDataURL(payload, {
        width: 220,
        margin: 1,
        color: { dark: '#0b0b0c', light: '#ffffff' },
      })
      dispatch({ type: 'SET_PAIRING', offer: offer as PairingOffer, pairingPayload: payload, qrDataUrl })
      // Snapshot the devices already paired, so the poll/event below can tell a
      // *new* pairing (a device id not in this set) from an existing one.
      pairBaselineRef.current = new Set(state.devices.filter((d) => d.publicKey).map((d) => d.id))
    } catch (err) {
      dispatch({ type: 'SET_ERROR', error: err instanceof Error ? err.message : String(err) })
    } finally {
      dispatch({ type: 'SET_LOADING', loading: false })
    }
  }

  const handleTransportChange = (transport: PairingTransport) => {
    dispatch({ type: 'SET_TRANSPORT', transport })
    dispatch({ type: 'SET_PAIRING', offer: null, pairingPayload: null, qrDataUrl: null })
    dispatch({ type: 'SET_ERROR', error: null })
    if (transport === 'lan' && state.ngrokTunnel.running) {
      void ipc.mobile.stopNgrokTunnel().then((tunnel: NgrokTunnelStatus | null) => {
        if (tunnel) dispatch({ type: 'SET_NGROK_TUNNEL', tunnel: tunnel as NgrokTunnelStatus })
      }).catch(() => undefined)
    }
  }

  const handleStopNgrokTunnel = async () => {
    dispatch({ type: 'SET_ERROR', error: null })
    try {
      const tunnel = await ipc.mobile.stopNgrokTunnel()
      if (tunnel) dispatch({ type: 'SET_NGROK_TUNNEL', tunnel: tunnel as NgrokTunnelStatus })
      dispatch({ type: 'SET_PAIRING', offer: null, pairingPayload: null, qrDataUrl: null })
    } catch (err) {
      dispatch({ type: 'SET_ERROR', error: err instanceof Error ? err.message : String(err) })
    }
  }

  const handleNgrokRegionChange = (region: MobileNgrokRegion) => {
    setMobileNgrokRegion(region)
    dispatch({ type: 'SET_PAIRING', offer: null, pairingPayload: null, qrDataUrl: null })
    dispatch({ type: 'SET_ERROR', error: null })
    if (state.ngrokTunnel.running) {
      void ipc.mobile.stopNgrokTunnel().then((tunnel: NgrokTunnelStatus | null) => {
        if (tunnel) dispatch({ type: 'SET_NGROK_TUNNEL', tunnel: tunnel as NgrokTunnelStatus })
      }).catch(() => undefined)
    }
  }

  const handleRemoveDevice = async (deviceId: string) => {
    confirmingRef.current = null
    await ipc.mobile.removeDevice(deviceId)
    await loadData()
  }

  const formatDate = (ts: number) => {
    if (!ts) return t('mobile.never')
    return new Date(ts).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  }

  const connectedIds = new Set(state.connectedDevices.map((d) => d.id))
  const pairedDevices = state.devices.filter((d) => d.publicKey)
  const running = state.serverRunning
  const tunnelReady = state.ngrokTunnel.running && Boolean(state.ngrokTunnel.endpoint)
  const transportOptions = [
    { value: 'lan' as const, label: t('mobile.transportLan') },
    { value: 'ngrok' as const, label: t('mobile.transportNgrok') },
  ]
  const ngrokRegionOptions: Array<{ value: MobileNgrokRegion; label: string }> = [
    { value: 'auto', label: t('mobile.ngrokRegionAuto') },
    { value: 'jp', label: t('mobile.ngrokRegionJapan') },
    { value: 'us', label: t('mobile.ngrokRegionUnitedStates') },
    { value: 'us-cal-1', label: t('mobile.ngrokRegionUsCalifornia') },
    { value: 'eu', label: t('mobile.ngrokRegionEurope') },
    { value: 'eu-lon-1', label: t('mobile.ngrokRegionEuropeLondon') },
    { value: 'ap', label: t('mobile.ngrokRegionAsiaPacific') },
    { value: 'au', label: t('mobile.ngrokRegionAustralia') },
    { value: 'in', label: t('mobile.ngrokRegionIndia') },
    { value: 'sa', label: t('mobile.ngrokRegionSouthAmerica') },
  ]

  return (
    <div className="mobile-settings">
      {/* ── Hero: pairing card + app preview ─────────────────────────── */}
      <div className="mobile-hero">
        {/* Pairing card */}
        <section className="mobile-pair-card">
          <div className="mobile-pair-pattern" aria-hidden="true">
            <span className="mobile-pair-lane mobile-pair-lane--top" />
            <span className="mobile-pair-lane mobile-pair-lane--middle" />
            <span className="mobile-pair-lane mobile-pair-lane--bottom" />
          </div>
          <header className="mobile-pair-head">
            <span className="mobile-pair-badge">
              <IconSmartphone size={18} />
            </span>
            <div className="mobile-pair-heading">
              <h3 className="mobile-pair-title">{t('mobile.pairTitle')}</h3>
              <p className="mobile-pair-sub">{t('mobile.enableServerDesc')}</p>
            </div>
            <span className="mobile-secure-chip">
              <IconLock size={11} />
              E2EE
            </span>
          </header>

          <div className="mobile-server-row">
            <span className="mobile-server-status">
              <StatusDot state={running ? 'success' : 'failure'} />
              {running ? t('mobile.running', { port: state.serverPort }) : t('mobile.enableServer')}
            </span>
            {running && <span className="mobile-server-chip">{state.pairingTransport === 'ngrok' ? 'ngrok' : 'LAN'}</span>}
            <Toggle checked={running} onChange={handleToggle} disabled={state.loading} />
          </div>

          {running && (
            <div className="mobile-transport-row">
              <div className="mobile-transport-copy">
                <span className="mobile-transport-label">{t('mobile.transportLabel')}</span>
                <span className="mobile-transport-desc">
                  {state.pairingTransport === 'ngrok' ? t('mobile.transportNgrokDesc') : t('mobile.transportLanDesc')}
                </span>
              </div>
              <SegmentedControl<PairingTransport>
                options={transportOptions}
                value={state.pairingTransport}
                onChange={handleTransportChange}
                disabled={state.loading}
              />
            </div>
          )}

          {running && state.pairingTransport === 'ngrok' && (
            <div className="mobile-ngrok-panel">
              <label className="mobile-ngrok-region">
                <span>{t('mobile.ngrokRegionLabel')}</span>
                <select
                  className="settings-select"
                  value={mobileNgrokRegion}
                  onChange={(event) => handleNgrokRegionChange(event.target.value as MobileNgrokRegion)}
                  disabled={state.loading}
                >
                  {ngrokRegionOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <div className="mobile-ngrok-status">
                <span className="mobile-ngrok-heading">
                  <IconGlobe size={13} />
                  <StatusDot state={tunnelReady ? 'success' : state.ngrokTunnel.error ? 'failure' : 'skipped'} />
                  {tunnelReady ? t('mobile.ngrokReady') : state.loading ? t('mobile.ngrokStarting') : t('mobile.ngrokStopped')}
                </span>
                {state.ngrokTunnel.endpoint && <code>{state.ngrokTunnel.endpoint}</code>}
              </div>
              <div className="mobile-ngrok-actions">
                <Button size="sm" onClick={handleCopyEndpoint} disabled={!state.ngrokTunnel.endpoint}>
                  <IconCopy size={13} />
                  {copiedEndpoint ? t('mobile.copiedEndpoint') : t('mobile.copyEndpoint')}
                </Button>
                <Button size="sm" onClick={handleStopNgrokTunnel} disabled={!state.ngrokTunnel.running}>
                  {t('mobile.stopTunnel')}
                </Button>
              </div>
            </div>
          )}

          {state.error && <div className="mobile-error">{state.error}</div>}

          {running ? (
            <div className="mobile-pair-body">
              {state.justPaired ? (
                <div className="mobile-paired">
                  <div className="mobile-paired-burst" aria-hidden="true">
                    <span className="mobile-paired-ring mobile-paired-ring--one" />
                    <span className="mobile-paired-ring mobile-paired-ring--two" />
                    <span className="mobile-paired-badge">
                      <IconCheckmark size={32} />
                    </span>
                  </div>
                  <h4 className="mobile-paired-title">{t('mobile.pairedTitle')}</h4>
                  <span className="mobile-paired-device">
                    <StatusDot state="success" />
                    <IconSmartphone size={13} />
                    <span className="mobile-paired-device-name">{state.justPaired.name || t('mobile.unnamed')}</span>
                    <span className="mobile-paired-e2ee"><IconLock size={10} />E2EE</span>
                  </span>
                  <p className="mobile-pair-cta-text">{t('mobile.pairedDesc', { name: state.justPaired.name || t('mobile.unnamed') })}</p>
                  <div className="mobile-paired-actions">
                    <Button variant="primary" onClick={() => { dispatch({ type: 'SET_JUST_PAIRED', device: null }); void handleGeneratePairing() }} disabled={state.loading}>
                      <IconSparkle size={14} />
                      {t('mobile.pairAnother')}
                    </Button>
                    <Button onClick={() => dispatch({ type: 'SET_JUST_PAIRED', device: null })}>
                      {t('mobile.pairedDone')}
                    </Button>
                  </div>
                </div>
              ) : state.qrDataUrl ? (
                <>
                  <div className="mobile-qr-stage">
                    <div className="mobile-qr-frame">
                      <span className="mobile-qr-scanline" aria-hidden="true" />
                      <img src={state.qrDataUrl} alt={t('mobile.pairTitle')} />
                    </div>
                    <div className="mobile-signal-stack" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </div>
                  </div>
                  <ol className="mobile-steps">
                    <li><span className="mobile-step-num">1</span><span>{t('mobile.step1')}</span></li>
                    <li><span className="mobile-step-num">2</span><span>{t('mobile.step2')}</span></li>
                  </ol>
                  <div className="mobile-qr-actions">
                    <Button size="sm" onClick={handleCopyCode} disabled={!state.pairingPayload}>
                      <IconCopy size={13} />
                      {copiedCode ? t('mobile.copiedCode') : t('mobile.copyCode')}
                    </Button>
                    <Button size="sm" onClick={handleGeneratePairing} disabled={state.loading}>
                      <IconRefresh size={13} />
                      {t('mobile.regenerateQr')}
                    </Button>
                  </div>
                </>
              ) : (
                <div className="mobile-pair-cta">
                  <div className="mobile-cta-visual" aria-hidden="true">
                    <span className="mobile-cta-device" />
                    <span className="mobile-cta-scan mobile-cta-scan--one" />
                    <span className="mobile-cta-scan mobile-cta-scan--two" />
                    <span className="mobile-cta-node mobile-cta-node--a" />
                    <span className="mobile-cta-node mobile-cta-node--b" />
                  </div>
                  <p className="mobile-pair-cta-text">{t('mobile.pairingHint')}</p>
                  <Button variant="primary" onClick={handleGeneratePairing} disabled={state.loading}>
                    <IconSparkle size={14} />
                    {t('mobile.generateQr')}
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="mobile-pair-disabled">{t('mobile.enableHint')}</div>
          )}
        </section>

        {/* App preview */}
        <aside className="mobile-preview" aria-hidden="true">
          <div className="mobile-device-stage">
            <span className="mobile-device-beam mobile-device-beam--one" />
            <span className="mobile-device-beam mobile-device-beam--two" />
            <span className="mobile-device-beam mobile-device-beam--three" />
            <div className="mobile-phone">
              <span className="mobile-phone-notch" />
              <div className="mobile-phone-screen">
                <div className="mobile-app-preview-header">
                  <span className="mobile-app-preview-brand">
                    <span className="mobile-app-preview-mark">B</span>
                    Braid
                  </span>
                  <span className="mobile-app-preview-icon" />
                </div>
                <div className="mobile-app-preview-actions">
                  <div className="mobile-app-preview-action">
                    <IconSmartphone size={12} />
                    <span>Pair Desktop</span>
                  </div>
                  <div className="mobile-app-preview-action">
                    <IconCopy size={12} />
                    <span>Enter Code</span>
                  </div>
                </div>
                <span className="mobile-app-preview-welcome">Welcome back</span>
                <div className="mobile-app-preview-stats">
                  <span><strong>1</strong>Need input</span>
                  <span><strong>2</strong>Working</span>
                  <span><strong>3</strong>Agents</span>
                </div>
                <span className="mobile-app-preview-section">Needs attention</span>
                <div className="mobile-app-preview-row">
                  <span className="mobile-app-preview-tile"><IconTerminal size={13} /></span>
                  <span className="mobile-app-preview-row-copy">
                    <span>Mobile Companion</span>
                    <small>mobile-app-init · Needs input</small>
                  </span>
                </div>
                <span className="mobile-app-preview-section">Desktops</span>
                <div className="mobile-app-preview-row">
                  <span className="mobile-app-preview-tile"><IconSmartphone size={13} /></span>
                  <span className="mobile-app-preview-row-copy">
                    <span>Braid desktop</span>
                    <small>Connected · 4 projects · 3 agents</small>
                  </span>
                </div>
              </div>
            </div>
          </div>
          <ul className="mobile-feature-list">
            {FEATURES.map(({ key, Icon }) => (
              <li key={key} className="mobile-feature">
                <span className="mobile-feature-icon"><Icon size={16} /></span>
                <div className="mobile-feature-info">
                  <span className="mobile-feature-name">{t(`mobile.feat.${key}.title`)}</span>
                  <span className="mobile-feature-desc">{t(`mobile.feat.${key}.desc`)}</span>
                </div>
              </li>
            ))}
          </ul>
        </aside>
      </div>

      {/* ── Paired devices ───────────────────────────────────────────── */}
      <section className="mobile-devices">
        <h4 className="settings-section-subtitle">{t('mobile.devicesHeader')}</h4>
        {pairedDevices.length === 0 ? (
          <span className="settings-hint">{t('mobile.noDevices')}</span>
        ) : (
          <div className="settings-skill-list">
            {pairedDevices.map((device) => (
              <div key={device.id} className="settings-skill-row">
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-8)', flex: 1, minWidth: 0 }}>
                  <StatusDot state={connectedIds.has(device.id) ? 'success' : 'skipped'} />
                  <div className="settings-skill-info">
                    <span className="settings-skill-name">{device.name || t('mobile.unnamed')}</span>
                    <span className="settings-skill-desc">
                      {t('mobile.lastSeen')}: {formatDate(device.lastSeenAt)}
                    </span>
                  </div>
                </div>
                {confirmingRef.current === device.id ? (
                  <div className="settings-skill-confirm">
                    <Button variant="danger" size="sm" onClick={() => handleRemoveDevice(device.id)}>
                      {t('mobile.remove')}
                    </Button>
                    <Button size="sm" onClick={() => { confirmingRef.current = null; forceRender() }}>
                      {t('mobile.cancel')}
                    </Button>
                  </div>
                ) : (
                  <button
                    className="settings-skill-delete-btn"
                    onClick={() => { confirmingRef.current = device.id; forceRender() }}
                  >
                    &times;
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
