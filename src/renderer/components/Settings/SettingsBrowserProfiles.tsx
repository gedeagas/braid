import { useCallback, useReducer } from 'react'
import { useTranslation } from 'react-i18next'
import { DEFAULT_BROWSER_PROFILE_ID, type BrowserCookieImportResult } from '@shared/browser'
import { useBrowserStore } from '@/store/browser'
import { Button } from '@/components/ui'
import { ContextMenu, type ContextMenuItem } from '@/components/shared/ContextMenu'
import * as ipc from '@/lib/ipc'

interface State {
  newName: string
  busyProfileId: string | null
  message: { profileId: string; text: string; error?: boolean } | null
  importMenu: { profileId: string; x: number; y: number; items: ContextMenuItem[] } | null
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'profile'
}

export function SettingsBrowserProfiles() {
  const { t } = useTranslation('settings')
  const settings = useBrowserStore((s) => s.settings)
  const update = useBrowserStore((s) => s.updateSettings)
  const applySettings = useBrowserStore((s) => s.applySettings)
  const [state, patch] = useReducer((s: State, p: Partial<State>) => ({ ...s, ...p }), {
    newName: '', busyProfileId: null, message: null, importMenu: null,
  })

  const addProfile = useCallback(() => {
    const name = state.newName.trim()
    if (!name) return
    let id = slugify(name)
    const taken = new Set(settings.profiles.map((p) => p.id))
    for (let n = 2; taken.has(id); n++) id = `${slugify(name)}-${n}`
    void update({ profiles: [...settings.profiles, { id, name }] })
    patch({ newName: '' })
  }, [state.newName, settings.profiles, update])

  const summarize = useCallback((r: BrowserCookieImportResult): string => {
    const parts = [t('browser.importResult', { count: r.imported, domains: r.domains })]
    if (r.skippedGoogle > 0) parts.push(t('browser.importSkippedGoogle'))
    if (r.failed > 0) parts.push(t('browser.importFailed', { count: r.failed }))
    return parts.join(' ')
  }, [t])

  const runImport = useCallback(async (profileId: string, task: () => Promise<BrowserCookieImportResult | null>) => {
    patch({ busyProfileId: profileId, message: null, importMenu: null })
    try {
      const result = await task()
      patch({ busyProfileId: null, message: result ? { profileId, text: summarize(result) } : null })
    } catch (err) {
      patch({ busyProfileId: null, message: { profileId, text: err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err), error: true } })
    }
  }, [summarize])

  const openImportMenu = useCallback(async (profileId: string, e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const browsers = await ipc.browser.listChromiumProfiles().catch(() => [])
    const items: ContextMenuItem[] = [
      { label: t('browser.importFromFile'), onClick: () => void runImport(profileId, () => ipc.browser.importCookiesFromFile(profileId)) },
      ...(browsers.length ? [{ label: '---', onClick: () => {} }] : []),
      ...browsers.map((b) => ({
        label: b.label,
        onClick: () => void runImport(profileId, () => ipc.browser.importCookiesFromBrowser(profileId, b.browser, b.profileDir)),
      })),
    ]
    patch({ importMenu: { profileId, x: rect.left, y: rect.bottom + 4, items } })
  }, [runImport, t])

  const clearData = useCallback(async (profileId: string) => {
    if (!window.confirm(t('browser.clearDataConfirm'))) return
    await ipc.browser.clearProfileData(profileId).catch(() => {})
    patch({ message: { profileId, text: t('browser.clearDataDone') } })
  }, [t])

  const deleteProfile = useCallback(async (profileId: string) => {
    if (!window.confirm(t('browser.deleteProfileConfirm'))) return
    try { applySettings(await ipc.browser.deleteProfile(profileId)) } catch { /* default profile */ }
  }, [applySettings, t])

  return (
    <>
      <h4 className="settings-section-subtitle">{t('browser.profilesHeader')}</h4>
      <span className="settings-hint">{t('browser.profilesHint')}</span>
      {settings.profiles.map((p) => (
        <div className="settings-card browser-profile-card" key={p.id}>
          <div className="settings-field settings-field--row">
            <span className="settings-card-title">{p.name}</span>
            <div className="browser-profile-actions">
              <Button size="sm" loading={state.busyProfileId === p.id} onClick={(e) => void openImportMenu(p.id, e)}>
                {t('browser.importCookies')}
              </Button>
              <Button size="sm" onClick={() => void clearData(p.id)}>{t('browser.clearData')}</Button>
              {p.id !== DEFAULT_BROWSER_PROFILE_ID && (
                <Button size="sm" variant="danger" onClick={() => void deleteProfile(p.id)}>{t('browser.deleteProfile')}</Button>
              )}
            </div>
          </div>
          {state.message?.profileId === p.id && (
            <span className={`settings-hint${state.message.error ? ' settings-hint--error' : ''}`}>{state.message.text}</span>
          )}
        </div>
      ))}
      <div className="settings-field">
        <div className="settings-input-row">
          <input
            className="settings-input"
            value={state.newName}
            placeholder={t('browser.newProfilePlaceholder')}
            onChange={(e) => patch({ newName: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') addProfile() }}
          />
          <Button size="sm" disabled={!state.newName.trim()} onClick={addProfile}>{t('browser.addProfile')}</Button>
        </div>
      </div>
      <span className="settings-hint">{t('browser.googleHint')}</span>
      {state.importMenu && (
        <ContextMenu x={state.importMenu.x} y={state.importMenu.y} items={state.importMenu.items} onClose={() => patch({ importMenu: null })} />
      )}
    </>
  )
}
