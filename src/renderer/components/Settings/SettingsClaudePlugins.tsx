import { useReducer, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import * as ipc from '@/lib/ipc'
import { Toggle } from '@/components/shared/Toggle'

// ── Types ────────────────────────────────────────────────────────────────────

interface PluginInfo {
  id: string
  name: string
  version: string
  scope: string
  enabled: boolean
}

// ── Reducer ──────────────────────────────────────────────────────────────────

interface State {
  plugins: PluginInfo[]
  loading: boolean
}

type Action =
  | { type: 'setPlugins'; plugins: PluginInfo[] }
  | { type: 'setLoading'; loading: boolean }
  | { type: 'togglePlugin'; id: string; enabled: boolean }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'setPlugins': return { ...state, plugins: action.plugins }
    case 'setLoading': return { ...state, loading: action.loading }
    case 'togglePlugin':
      return {
        ...state,
        plugins: state.plugins.map((p) =>
          p.id === action.id ? { ...p, enabled: action.enabled } : p
        ),
      }
  }
}

// ── Component ────────────────────────────────────────────────────────────────

export function SettingsClaudePlugins() {
  const { t } = useTranslation('settings')

  const [state, dispatch] = useReducer(reducer, {
    plugins: [],
    loading: true,
  })

  useEffect(() => {
    dispatch({ type: 'setLoading', loading: true })
    ipc.claudeConfig.getPlugins()
      .then((plugins) => dispatch({ type: 'setPlugins', plugins }))
      .finally(() => dispatch({ type: 'setLoading', loading: false }))
  }, [])

  const togglePlugin = useCallback((id: string, enabled: boolean) => {
    dispatch({ type: 'togglePlugin', id, enabled })
    ipc.claudeConfig.setPluginEnabled(id, enabled).catch(() => {
      dispatch({ type: 'togglePlugin', id, enabled: !enabled })
    })
  }, [])

  return (
    <div className="settings-section">
      <div className="settings-field">
        <label className="settings-label">{t('claudePlugins.title')}</label>
        <span className="settings-hint">{t('claudePlugins.hint')}</span>
      </div>

      {state.plugins.length === 0 && !state.loading && (
        <p className="settings-empty-state">{t('claudePlugins.noPlugins')}</p>
      )}

      <div className="settings-plugin-list">
        {state.plugins.map((plugin) => (
          <div
            key={plugin.id}
            className={`settings-plugin-row${plugin.enabled ? '' : ' settings-plugin-row--disabled'}`}
          >
            <div className="settings-plugin-info">
              <span className="settings-plugin-name">{plugin.name}</span>
              <span className="settings-plugin-meta">
                <span className="settings-plugin-badge">{t('claudePlugins.version', { version: plugin.version })}</span>
                <span className="settings-plugin-badge">{t('claudePlugins.scope', { scope: plugin.scope })}</span>
              </span>
            </div>
            <Toggle
              checked={plugin.enabled}
              onChange={(enabled) => togglePlugin(plugin.id, enabled)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
