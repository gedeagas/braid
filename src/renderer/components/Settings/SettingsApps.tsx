import { useReducer, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useUIStore } from '@/store/ui'
import { AppFavicon } from '@/components/shared/AppFavicon'
import { useTabReorder } from '@/hooks/useTabReorder'
import { Toggle } from '@/components/shared/Toggle'
import { getDisabledEmbeddedAppWarningKey } from '@/lib/embeddedApps'
import type { EmbeddedApp } from '@/types'

interface Preset {
  name: string
  url: string
  /** If set, show an inline input for workspace subdomain before adding */
  workspaceHint?: string
  workspaceUrlTemplate?: string
}

const PRESETS: Preset[] = [
  {
    name: 'Slack',
    url: 'https://slack.com',
    workspaceHint: 'mycompany',
    workspaceUrlTemplate: 'https://{workspace}.slack.com',
  },
  { name: 'Notion',  url: 'https://notion.so' },
  { name: 'Jira',    url: 'https://id.atlassian.com' },
  { name: 'Spotify', url: 'https://open.spotify.com' },
]

interface FormState {
  name: string
  url: string
  error: string
  /** Which preset is pending workspace input */
  pendingPreset: string | null
  workspace: string
}

type FormAction =
  | { type: 'setName'; value: string }
  | { type: 'setUrl'; value: string }
  | { type: 'setError'; value: string }
  | { type: 'reset' }
  | { type: 'startWorkspace'; preset: string }
  | { type: 'setWorkspace'; value: string }
  | { type: 'cancelWorkspace' }

function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'setName': return { ...state, name: action.value, error: '' }
    case 'setUrl':  return { ...state, url: action.value, error: '' }
    case 'setError': return { ...state, error: action.value }
    case 'reset': return { ...state, name: '', url: '', error: '' }
    case 'startWorkspace': return { ...state, pendingPreset: action.preset, workspace: '', error: '' }
    case 'setWorkspace': return { ...state, workspace: action.value, error: '' }
    case 'cancelWorkspace': return { ...state, pendingPreset: null, workspace: '', error: '' }
  }
}

export function SettingsApps() {
  const { t } = useTranslation('settings')
  const webAppsEnabled = useUIStore((s) => s.webAppsEnabled)
  const setWebAppsEnabled = useUIStore((s) => s.setWebAppsEnabled)
  const embeddedApps = useUIStore(useShallow((s) => s.embeddedApps))
  const addEmbeddedApp = useUIStore((s) => s.addEmbeddedApp)
  const removeEmbeddedApp = useUIStore((s) => s.removeEmbeddedApp)
  const hideWebApp = useUIStore((s) => s.hideWebApp)
  const showWebApp = useUIStore((s) => s.showWebApp)
  const reorderEmbeddedApps = useUIStore((s) => s.reorderEmbeddedApps)

  const appIds = useMemo(() => embeddedApps.map((a) => a.id), [embeddedApps])
  const { dragKey, overKey, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd } =
    useTabReorder(appIds, reorderEmbeddedApps)

  const [form, dispatch] = useReducer(formReducer, {
    name: '', url: '', error: '', pendingPreset: null, workspace: '',
  })

  const handleAddCustom = useCallback(() => {
    const trimUrl = form.url.trim()
    const trimName = form.name.trim()
    if (!trimName) { dispatch({ type: 'setError', value: t('apps.nameRequired') }); return }
    if (!trimUrl.startsWith('http://') && !trimUrl.startsWith('https://')) {
      dispatch({ type: 'setError', value: t('apps.invalidUrl') }); return
    }
    const disabledWarningKey = getDisabledEmbeddedAppWarningKey({ name: trimName, url: trimUrl })
    if (disabledWarningKey) { dispatch({ type: 'setError', value: t(disabledWarningKey) }); return }
    addEmbeddedApp({ id: crypto.randomUUID(), name: trimName, url: trimUrl, visible: true })
    dispatch({ type: 'reset' })
  }, [form, addEmbeddedApp, t])

  const handleAddPreset = useCallback((preset: Preset) => {
    if (getDisabledEmbeddedAppWarningKey(preset)) return

    if (preset.workspaceUrlTemplate) {
      dispatch({ type: 'startWorkspace', preset: preset.name })
    } else {
      addEmbeddedApp({ id: crypto.randomUUID(), name: preset.name, url: preset.url, visible: true })
    }
  }, [addEmbeddedApp])

  const handleConfirmWorkspace = useCallback(() => {
    const workspace = form.workspace.trim().toLowerCase()
    if (!workspace) { dispatch({ type: 'setError', value: t('apps.workspaceRequired') }); return }
    const preset = PRESETS.find((p) => p.name === form.pendingPreset)
    if (!preset?.workspaceUrlTemplate) return
    const url = preset.workspaceUrlTemplate.replace('{workspace}', workspace)
    addEmbeddedApp({ id: crypto.randomUUID(), name: preset.name, url, visible: true })
    dispatch({ type: 'cancelWorkspace' })
  }, [form.workspace, form.pendingPreset, addEmbeddedApp])

  return (
    <div className="settings-section">
      <div className="settings-field settings-field--row">
        <label className="settings-label">{t('apps.enableToggle')}</label>
        <Toggle checked={webAppsEnabled} onChange={setWebAppsEnabled} />
      </div>
      <span className="settings-hint">{t('apps.enableHint')}</span>

      <div className="settings-divider" />

      <div className="settings-field">
        <span className="settings-section-subtitle">{t('apps.officialHeader')}</span>
        <div className="settings-apps-presets">
          {PRESETS.map((preset) => {
            const alreadyAdded = embeddedApps.some((a) => a.name === preset.name)
            const disabledWarningKey = getDisabledEmbeddedAppWarningKey(preset)
            const warningId = disabledWarningKey ? `settings-apps-preset-${preset.name.toLowerCase()}-warning` : undefined
            return (
              <button
                key={preset.name}
                className={[
                  'btn',
                  'btn--sm',
                  disabledWarningKey ? 'settings-apps-preset--disabled' : '',
                ].filter(Boolean).join(' ')}
                disabled={alreadyAdded || Boolean(disabledWarningKey)}
                aria-describedby={warningId}
                title={disabledWarningKey ? t(disabledWarningKey) : undefined}
                onClick={() => handleAddPreset(preset)}
              >
                <AppFavicon url={preset.url} name={preset.name} size={14} />
                {disabledWarningKey ? preset.name : alreadyAdded ? t('apps.added') : preset.name}
                {disabledWarningKey && (
                  <span className="settings-apps-preset-disabled-label">
                    {t('apps.disabled')}
                  </span>
                )}
              </button>
            )
          })}
        </div>
        {PRESETS.map((preset) => {
          const disabledWarningKey = getDisabledEmbeddedAppWarningKey(preset)
          if (!disabledWarningKey) return null

          return (
            <div
              key={`${preset.name}-warning`}
              id={`settings-apps-preset-${preset.name.toLowerCase()}-warning`}
              className="settings-apps-warning"
            >
              <span className="settings-apps-warning-label">{t('apps.disabled')}</span>
              <span>{t(disabledWarningKey)}</span>
            </div>
          )
        })}
        {form.pendingPreset && (() => {
          const preset = PRESETS.find((p) => p.name === form.pendingPreset)
          if (!preset) return null
          return (
            <div className="settings-apps-custom-row" style={{ marginTop: 8 }}>
              <input
                className={`settings-input${form.error ? ' settings-input--error' : ''}`}
                placeholder={preset.workspaceHint ?? 'workspace'}
                value={form.workspace}
                onChange={(e) => dispatch({ type: 'setWorkspace', value: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleConfirmWorkspace()
                  if (e.key === 'Escape') dispatch({ type: 'cancelWorkspace' })
                }}
                autoFocus
                style={{ flex: '0 0 160px' }}
              />
              <span className="settings-hint" style={{ alignSelf: 'center' }}>.slack.com</span>
              <button className="btn btn-primary btn--sm" onClick={handleConfirmWorkspace}>
                {t('apps.add')}
              </button>
              <button className="btn btn--sm" onClick={() => dispatch({ type: 'cancelWorkspace' })}>
                {t('common:cancel', 'Cancel')}
              </button>
            </div>
          )
        })()}
      </div>

      <div className="settings-divider" />

      <div className="settings-field">
        <span className="settings-section-subtitle">{t('apps.customHeader')}</span>
        <div className="settings-apps-custom-row">
          <input
            className={`settings-input${form.error && !form.pendingPreset ? ' settings-input--error' : ''}`}
            placeholder={t('apps.namePlaceholder')}
            value={form.name}
            onChange={(e) => dispatch({ type: 'setName', value: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && handleAddCustom()}
            style={{ flex: '0 0 140px' }}
          />
          <input
            className={`settings-input${form.error && !form.pendingPreset ? ' settings-input--error' : ''}`}
            placeholder={t('apps.urlPlaceholder')}
            value={form.url}
            onChange={(e) => dispatch({ type: 'setUrl', value: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && handleAddCustom()}
            style={{ flex: 1, minWidth: 180 }}
          />
          <button className="btn btn-primary btn--sm" onClick={handleAddCustom}>
            {t('apps.add')}
          </button>
        </div>
        {form.error && !form.pendingPreset && <span className="settings-hint" style={{ color: 'var(--red)' }}>{form.error}</span>}
      </div>

      {embeddedApps.length > 0 && (
        <>
          <div className="settings-divider" />
          <div className="settings-field">
            <span className="settings-section-subtitle">{t('apps.configuredHeader')}</span>
            <div className="settings-apps-list">
              {embeddedApps.map((app: EmbeddedApp) => {
                const disabledWarningKey = getDisabledEmbeddedAppWarningKey(app)
                return (
                  <div
                    key={app.id}
                    className={[
                      'settings-apps-list-row',
                      disabledWarningKey ? 'settings-apps-list-row--disabled' : '',
                      dragKey === app.id ? 'settings-apps-list-row--dragging' : '',
                      overKey === app.id ? 'settings-apps-list-row--drag-over' : '',
                    ].filter(Boolean).join(' ')}
                    draggable
                    title={disabledWarningKey ? t(disabledWarningKey) : undefined}
                    onDragStart={onDragStart(app.id)}
                    onDragOver={onDragOver(app.id)}
                    onDragLeave={onDragLeave}
                    onDrop={onDrop(app.id)}
                    onDragEnd={onDragEnd}
                  >
                    <span className="settings-apps-drag-handle">⠿</span>
                    <AppFavicon url={app.url} name={app.name} size={16} />
                    <span className="settings-apps-list-name">{app.name}</span>
                    <span className="settings-apps-list-url">{app.url}</span>
                    {disabledWarningKey && (
                      <span className="settings-apps-list-warning">{t('apps.disabled')}</span>
                    )}
                    <button
                      className="btn btn--sm"
                      onClick={() => app.visible ? hideWebApp(app.id) : showWebApp(app.id)}
                    >
                      {app.visible ? t('apps.hide') : t('apps.show')}
                    </button>
                    <button
                      className="btn btn-danger btn--sm"
                      onClick={() => removeEmbeddedApp(app.id)}
                    >
                      ×
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
