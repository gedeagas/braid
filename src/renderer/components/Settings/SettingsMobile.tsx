import { useReducer, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import QRCode from 'qrcode'
import { useUIStore } from '@/store/ui'
import { Toggle } from '@/components/shared/Toggle'
import { FormField } from '@/components/ui'
import { Button } from '@/components/ui'
import { StatusDot } from '@/components/ui/StatusDot'
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
  | { type: 'SET_PAIRING'; offer: PairingOffer | null; qrDataUrl: string | null }
  | { type: 'SET_LOADING'; loading: boolean }
  | { type: 'SET_ERROR'; error: string | null }

function reducer(state: MobileState, action: MobileAction): MobileState {
  switch (action.type) {
    case 'SET_STATUS':
      return { ...state, serverRunning: action.running, serverPort: action.port, connectedDevices: action.connectedDevices }
    case 'SET_DEVICES':
      return { ...state, devices: action.devices }
    case 'SET_PAIRING':
      return { ...state, pairingOffer: action.offer, qrDataUrl: action.qrDataUrl }
    case 'SET_LOADING':
      return { ...state, loading: action.loading }
    case 'SET_ERROR':
      return { ...state, error: action.error }
  }
}

export function SettingsMobile() {
  const { t } = useTranslation('settings')
  const mobileServerEnabled = useUIStore((s) => s.mobileServerEnabled)
  const setMobileServerEnabled = useUIStore((s) => s.setMobileServerEnabled)
  const confirmingRef = useRef<string | null>(null)
  const [, forceRender] = useReducer((x: number) => x + 1, 0)

  const [state, dispatch] = useReducer(reducer, {
    devices: [],
    pairingOffer: null,
    qrDataUrl: null,
    serverRunning: false,
    serverPort: null,
    connectedDevices: [],
    loading: false,
    error: null,
  })

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
        dispatch({ type: 'SET_PAIRING', offer: null, qrDataUrl: null })
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
        width: 200,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
      })
      dispatch({ type: 'SET_PAIRING', offer: offer as PairingOffer, qrDataUrl })
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

  return (
    <div className="settings-section">
      <span className="settings-hint">{t('mobile.enableServerDesc')}</span>

      <div className="settings-divider" />

      {/* ── Server status ────────────────────────────────────────────── */}
      <h4 className="settings-section-subtitle">{t('mobile.serverHeader')}</h4>

      <div className="settings-field settings-field--row">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-8)' }}>
          <StatusDot state={state.serverRunning ? 'success' : 'failure'} />
          <span className="settings-label">
            {state.serverRunning
              ? t('mobile.running', { port: state.serverPort })
              : t('mobile.enableServer')}
          </span>
        </div>
        <Toggle
          checked={mobileServerEnabled}
          onChange={handleToggle}
          disabled={state.loading}
        />
      </div>

      {state.error && (
        <div className="settings-field" style={{ color: 'var(--text-danger)' }}>
          {state.error}
        </div>
      )}

      {/* ── Pairing ──────────────────────────────────────────────────── */}
      {state.serverRunning && (
        <>
          <div className="settings-divider" />
          <h4 className="settings-section-subtitle">{t('mobile.pairingHeader')}</h4>

          {state.qrDataUrl ? (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 'var(--space-12)',
              padding: 'var(--space-16)',
            }}>
              <img
                src={state.qrDataUrl}
                alt="Pairing QR code"
                style={{ width: 200, height: 200, borderRadius: 'var(--radius)' }}
              />
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', textAlign: 'center' }}>
                {t('mobile.pairingHint')}
              </span>
              <Button size="sm" onClick={handleGeneratePairing}>
                {t('mobile.regenerateQr')}
              </Button>
            </div>
          ) : (
            <div className="settings-field">
              <Button size="sm" variant="primary" onClick={handleGeneratePairing}>
                {t('mobile.generateQr')}
              </Button>
            </div>
          )}
        </>
      )}

      {/* ── Paired devices ───────────────────────────────────────────── */}
      <div className="settings-divider" />
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
                    Cancel
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
    </div>
  )
}
