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
          <header className="mobile-pair-head">
            <span className="mobile-pair-badge">
              <IconSmartphone size={18} />
            </span>
            <div className="mobile-pair-heading">
              <h3 className="mobile-pair-title">{t('mobile.pairTitle')}</h3>
              <p className="mobile-pair-sub">{t('mobile.enableServerDesc')}</p>
            </div>
          </header>

          <div className="mobile-server-row">
            <span className="mobile-server-status">
              <StatusDot state={running ? 'success' : 'failure'} />
              {running ? t('mobile.running', { port: state.serverPort }) : t('mobile.enableServer')}
            </span>
            <Toggle checked={running} onChange={handleToggle} disabled={state.loading} />
          </div>

          {state.error && <div className="mobile-error">{state.error}</div>}

          {running ? (
            <div className="mobile-pair-body">
              {state.qrDataUrl ? (
                <>
                  <div className="mobile-qr-frame">
                    <img src={state.qrDataUrl} alt={t('mobile.pairTitle')} />
                  </div>
                  <ol className="mobile-steps">
                    <li><span className="mobile-step-num">1</span>{t('mobile.step1')}</li>
                    <li><span className="mobile-step-num">2</span>{t('mobile.step2')}</li>
                  </ol>
                  <div className="mobile-qr-actions">
                    <Button size="sm" onClick={handleCopy} disabled={!state.pairingPayload}>
                      {copied ? t('mobile.copiedCode') : t('mobile.copyCode')}
                    </Button>
                    <Button size="sm" onClick={handleGeneratePairing}>
                      {t('mobile.regenerateQr')}
                    </Button>
                  </div>
                </>
              ) : (
                <div className="mobile-pair-cta">
                  <p className="mobile-pair-cta-text">{t('mobile.pairingHint')}</p>
                  <Button variant="primary" onClick={handleGeneratePairing}>
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
          <div className="mobile-phone">
            <span className="mobile-phone-notch" />
            <div className="mobile-phone-screen">
              <span className="mobile-phone-title">{t('mobile.previewTitle')}</span>
              {FEATURES.map(({ key, Icon }) => (
                <div key={key} className="mobile-phone-row">
                  <span className="mobile-phone-row-icon"><Icon size={14} /></span>
                  <span className="mobile-phone-row-label">{t(`mobile.feat.${key}.title`)}</span>
                </div>
              ))}
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
