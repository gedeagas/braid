import { useReducer, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/store/ui'
import { Toggle } from '@/components/shared/Toggle'
import { FormField } from '@/components/ui'
import { Button } from '@/components/ui'
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
  serverRunning: boolean
  serverPort: number | null
  connectedDevices: Array<{ id: string; name: string; connectedAt: number }>
  loading: boolean
  error: string | null
}

type MobileAction =
  | { type: 'SET_STATUS'; running: boolean; port: number | null; connectedDevices: Array<{ id: string; name: string; connectedAt: number }> }
  | { type: 'SET_DEVICES'; devices: MobileDevice[] }
  | { type: 'SET_PAIRING_OFFER'; offer: PairingOffer | null }
  | { type: 'SET_LOADING'; loading: boolean }
  | { type: 'SET_ERROR'; error: string | null }

function reducer(state: MobileState, action: MobileAction): MobileState {
  switch (action.type) {
    case 'SET_STATUS':
      return { ...state, serverRunning: action.running, serverPort: action.port, connectedDevices: action.connectedDevices }
    case 'SET_DEVICES':
      return { ...state, devices: action.devices }
    case 'SET_PAIRING_OFFER':
      return { ...state, pairingOffer: action.offer }
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

  const [state, dispatch] = useReducer(reducer, {
    devices: [],
    pairingOffer: null,
    serverRunning: false,
    serverPort: null,
    connectedDevices: [],
    loading: false,
    error: null,
  })

  // Load status and devices on mount
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
        dispatch({ type: 'SET_PAIRING_OFFER', offer: null })
      }
      setMobileServerEnabled(enabled)
      await loadData()
    } catch (err) {
      dispatch({ type: 'SET_ERROR', error: err instanceof Error ? err.message : String(err) })
    } finally {
      dispatch({ type: 'SET_LOADING', loading: false })
    }
  }

  const handleGenerateQr = async () => {
    dispatch({ type: 'SET_ERROR', error: null })
    try {
      const offer = await ipc.mobile.generatePairingOffer()
      dispatch({ type: 'SET_PAIRING_OFFER', offer: offer as PairingOffer | null })
    } catch (err) {
      dispatch({ type: 'SET_ERROR', error: err instanceof Error ? err.message : String(err) })
    }
  }

  const handleRemoveDevice = async (deviceId: string) => {
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

  return (
    <div className="settings-section">
      <h4 className="settings-section-subtitle">{t('mobile.serverHeader')}</h4>

      <FormField label={t('mobile.enableServer')} hint={t('mobile.enableServerDesc')} horizontal>
        <Toggle
          checked={mobileServerEnabled}
          onChange={handleToggle}
          disabled={state.loading}
        />
      </FormField>

      {state.error && (
        <div className="settings-field" style={{ color: 'var(--text-danger)' }}>
          {state.error}
        </div>
      )}

      {state.serverRunning && (
        <>
          <div className="settings-divider" />

          <div className="settings-field">
            <span className="settings-label">{t('mobile.status')}</span>
            <span style={{ color: 'var(--text-success)' }}>
              {t('mobile.running', { port: state.serverPort })}
            </span>
          </div>

          {state.connectedDevices.length > 0 && (
            <div className="settings-field">
              <span className="settings-label">{t('mobile.connectedNow')}</span>
              <span>{state.connectedDevices.map((d) => d.name).join(', ')}</span>
            </div>
          )}

          <div className="settings-divider" />
          <h4 className="settings-section-subtitle">{t('mobile.pairingHeader')}</h4>

          <div className="settings-field">
            <Button
              size="sm"
              onClick={handleGenerateQr}
            >
              {t('mobile.generateQr')}
            </Button>
          </div>

          {state.pairingOffer && (
            <div className="settings-card" style={{ fontFamily: 'var(--font-mono)' }}>
              <p className="settings-card-title">{t('mobile.pairingCode')}</p>
              <code style={{ fontSize: 'var(--text-xs)', wordBreak: 'break-all', userSelect: 'all' }}>
                {btoa(JSON.stringify(state.pairingOffer))}
              </code>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 'var(--space-4)' }}>
                {t('mobile.pairingHint')}
              </p>
            </div>
          )}
        </>
      )}

      <div className="settings-divider" />
      <h4 className="settings-section-subtitle">{t('mobile.devicesHeader')}</h4>

      {state.devices.length === 0 ? (
        <div className="settings-field" style={{ color: 'var(--text-muted)' }}>
          {t('mobile.noDevices')}
        </div>
      ) : (
        state.devices.filter((d) => d.publicKey).map((device) => (
          <div key={device.id} className="settings-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p className="settings-card-title">{device.name || t('mobile.unnamed')}</p>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                {t('mobile.paired')}: {formatDate(device.pairedAt)}
                {' - '}
                {t('mobile.lastSeen')}: {formatDate(device.lastSeenAt)}
              </p>
            </div>
            <Button
              variant="danger"
              size="sm"
              onClick={() => handleRemoveDevice(device.id)}
            >
              {t('mobile.remove')}
            </Button>
          </div>
        ))
      )}
    </div>
  )
}
