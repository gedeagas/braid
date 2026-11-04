import { memo, useEffect, useMemo, useReducer } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useBrowserStore, DOWNLOAD_SHELF_LINGER_MS } from '@/store/browser'
import { Button, Spinner } from '@/components/ui'
import { IconClose, IconSparkle } from '@/components/shared/icons'
import * as ipc from '@/lib/ipc'

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/** Current time, refreshed on an interval while `active` (for banners/shelves that expire). */
function useNow(active: boolean, ms: number): number {
  const [now, bump] = useReducer(() => Date.now(), 0, () => Date.now())
  useEffect(() => {
    if (!active) return
    const id = setInterval(bump, ms)
    return () => clearInterval(id)
  }, [active, ms])
  return now
}

export const PermissionBar = memo(function PermissionBar({ webContentsId }: { webContentsId: number | null }) {
  const { t } = useTranslation('center')
  const request = useBrowserStore((s) => s.permissionRequests.find((r) => r.webContentsId === webContentsId))
  const resolve = useBrowserStore((s) => s.resolvePermissionRequest)
  if (!request) return null
  const label = t(`browser.permission.${request.permission}`, { defaultValue: request.permission })
  return (
    <div className="browser-bar browser-bar--permission" role="alert">
      <span className="browser-bar-text">{t('browser.permissionAsk', { origin: request.origin, permission: label })}</span>
      <Button size="sm" onClick={() => resolve(request.id, false, false)}>{t('browser.permissionBlock')}</Button>
      <Button size="sm" onClick={() => resolve(request.id, true, false)}>{t('browser.permissionAllowOnce')}</Button>
      <Button size="sm" variant="primary" onClick={() => resolve(request.id, true, true)}>{t('browser.permissionAllow')}</Button>
    </div>
  )
})

export const DownloadShelf = memo(function DownloadShelf({ webContentsId }: { webContentsId: number | null }) {
  const { t } = useTranslation('center')
  const all = useBrowserStore(useShallow((s) => s.downloads.filter((d) => d.webContentsId === webContentsId)))
  const dismiss = useBrowserStore((s) => s.dismissDownload)
  const now = useNow(all.length > 0, 5000)
  // Finished items age out of the shelf; running ones always show.
  const visible = useMemo(
    () => all.filter((d) => d.state === 'progressing' || d.startedAt > now - DOWNLOAD_SHELF_LINGER_MS),
    [all, now],
  )
  if (visible.length === 0) return null
  return (
    <div className="browser-downloads" aria-live="polite">
      {visible.map((d) => {
        const pct = d.totalBytes > 0 ? Math.round((d.receivedBytes / d.totalBytes) * 100) : null
        return (
          <div key={d.id} className={`browser-download browser-download--${d.state}`}>
            {d.state === 'progressing' && <Spinner size="sm" />}
            <span className="browser-download-name" title={d.savePath}>{d.filename}</span>
            <span className="browser-download-meta">
              {d.state === 'progressing'
                ? (pct !== null ? `${pct}% · ${formatBytes(d.receivedBytes)} / ${formatBytes(d.totalBytes)}` : formatBytes(d.receivedBytes))
                : t(`browser.download.${d.state}`)}
            </span>
            {d.state === 'progressing' && <Button size="sm" onClick={() => ipc.browser.downloadCancel(d.id)}>{t('browser.download.cancel')}</Button>}
            {d.state === 'completed' && <Button size="sm" onClick={() => ipc.browser.downloadOpen(d.id)}>{t('browser.download.open')}</Button>}
            {d.state === 'completed' && <Button size="sm" onClick={() => ipc.browser.downloadShow(d.id)}>{t('browser.download.show')}</Button>}
            {d.state !== 'progressing' && (
              <Button size="icon" className="browser-icon-btn" aria-label={t('browser.download.dismiss')} onClick={() => dismiss(d.id)}>
                <IconClose size={12} />
              </Button>
            )}
          </div>
        )
      })}
    </div>
  )
})

export const AutomationBanner = memo(function AutomationBanner({ tabId }: { tabId: string }) {
  const { t } = useTranslation('center')
  const until = useBrowserStore((s) => s.automationUntil[tabId] ?? 0)
  const now = useNow(until > Date.now(), 1000)
  if (until <= now) return null
  return (
    <div className="browser-bar browser-bar--agent" role="status">
      <IconSparkle size={12} />
      <span className="browser-bar-text">{t('browser.agentActive')}</span>
    </div>
  )
})
