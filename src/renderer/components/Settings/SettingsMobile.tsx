import { useReducer, useCallback, useEffect, useRef, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import QRCode from 'qrcode'
import { useUIStore } from '@/store/ui'
import { Toggle } from '@/components/shared/Toggle'
import { Button } from '@/components/ui'
import { StatusDot } from '@/components/ui/StatusDot'
import {
  IconTerminal,
  IconInbox,
  IconGitBranch,
  IconSmartphone,
  IconLock,
  IconSparkle,
  IconCopy,
  IconRefresh,
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
}

interface MobileState {
  devices: MobileDevice[]
  pairingOffer: PairingOffer | null
  pairingPayload: string | null
  qrDataUrl: string | null
  serverRunning: boolean
  serverPort: number | null
  connectedDevices: Array<{ id: string; name: string; connectedAt: number }>
  loading: boolean
  error: string | null
}

type MobileAction =
  | { type: 'SET_STATUS'; running: boolean; port: number | null; connectedDevices: Array<{ id: string; name: string; connectedAt: number }> }
  | { type: 'SET_DEVICES'; devices: MobileDevice[] }
  | { type: 'SET_PAIRING'; offer: PairingOffer | null; pairingPayload: string | null; qrDataUrl: string | null }
  | { type: 'SET_LOADING'; loading: boolean }
  | { type: 'SET_ERROR'; error: string | null }

function reducer(state: MobileState, action: MobileAction): MobileState {
  switch (action.type) {
    case 'SET_STATUS':
      return { ...state, serverRunning: action.running, serverPort: action.port, connectedDevices: action.connectedDevices }
    case 'SET_DEVICES':
      return { ...state, devices: action.devices }
    case 'SET_PAIRING':
      return { ...state, pairingOffer: action.offer, pairingPayload: action.pairingPayload, qrDataUrl: action.qrDataUrl }
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
  const confirmingRef = useRef<string | null>(null)
  const [, forceRender] = useReducer((x: number) => x + 1, 0)

  const [state, dispatch] = useReducer(reducer, {
    devices: [],
    pairingOffer: null,
    pairingPayload: null,
    qrDataUrl: null,
    serverRunning: false,
    serverPort: null,
    connectedDevices: [],
    loading: false,
    error: null,
  })

  const { copied, handleCopy } = useCopyToClipboard(state.pairingPayload ?? '')

  const loadData = useCallback(async () => {
    try {
      const [status, devices] = await Promise.all([
        ipc.mobile.getStatus(),
        ipc.mobile.getDevices(),
      ])
      dispatch({ type: 'SET_STATUS', running: status.running, port: status.port, connectedDevices: status.connectedDevices })
      dispatch({ type: 'SET_DEVICES', devices: devices as MobileDevice[] })
    } catch {
      // Server may not be running
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleToggle = async (enabled: boolean) => {
    dispatch({ type: 'SET_LOADING', loading: true })
    dispatch({ type: 'SET_ERROR', error: null })
    try {
      if (enabled) {
        await ipc.mobile.start()
      } else {
        await ipc.mobile.stop()
        dispatch({ type: 'SET_PAIRING', offer: null, pairingPayload: null, qrDataUrl: null })
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
    dispatch({ type: 'SET_ERROR', error: null })
    try {
      const offer = await ipc.mobile.generatePairingOffer()
      if (!offer) return
      const payload = btoa(JSON.stringify(offer))
      const qrDataUrl = await QRCode.toDataURL(payload, {
        width: 220,
        margin: 1,
        color: { dark: '#0b0b0c', light: '#ffffff' },
      })
      dispatch({ type: 'SET_PAIRING', offer: offer as PairingOffer, pairingPayload: payload, qrDataUrl })
    } catch (err) {
      dispatch({ type: 'SET_ERROR', error: err instanceof Error ? err.message : String(err) })
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
            {running && <span className="mobile-server-chip">LAN</span>}
            <Toggle checked={running} onChange={handleToggle} disabled={state.loading} />
          </div>

          {state.error && <div className="mobile-error">{state.error}</div>}

          {running ? (
            <div className="mobile-pair-body">
              {state.qrDataUrl ? (
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
                    <Button size="sm" onClick={handleCopy} disabled={!state.pairingPayload}>
                      <IconCopy size={13} />
                      {copied ? t('mobile.copiedCode') : t('mobile.copyCode')}
                    </Button>
                    <Button size="sm" onClick={handleGeneratePairing}>
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
                  <Button variant="primary" onClick={handleGeneratePairing}>
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
