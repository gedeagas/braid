// ---------------------------------------------------------------------------
// UpdateDialog - shows update available / downloading / ready-to-install UI
// ---------------------------------------------------------------------------

import { useTranslation } from 'react-i18next'
import { Dialog, Button } from '@/components/ui'
import type { UpdateState } from '@/hooks/useAutoUpdate'

interface UpdateDialogProps {
  state: UpdateState
  onDownload: () => void
  onInstall: () => void
  onDismiss: () => void
  onRetry: () => void
}

// No-op close handler for non-dismissible dialogs (downloading state).
// Dialog requires onClose, but we don't want backdrop/Escape to do anything.
const noop = () => {}

export function UpdateDialog({ state, onDownload, onInstall, onDismiss, onRetry }: UpdateDialogProps) {
  const { t } = useTranslation('common')

  const isOpen =
    (state.status === 'available' && !state.dismissed) ||
    state.status === 'downloading' ||
    (state.status === 'ready' && !state.dismissed) ||
    state.status === 'error'

  if (!isOpen) return null

  // ── Available: prompt to download ─────────────────────────────────────
  if (state.status === 'available') {
    return (
      <Dialog
        isOpen
        onClose={onDismiss}
        title={t('update.available.title')}
        width="460px"
        actions={
          <>
            <Button onClick={onDismiss}>{t('update.later')}</Button>
            <Button variant="primary" onClick={onDownload}>{t('update.download')}</Button>
          </>
        }
      >
        <p className="update-dialog__body">
          {t('update.available.body', { version: state.version })}
        </p>
        {state.releaseNotes && (
          <>
            <p className="update-dialog__notes-label">{t('update.available.whatsNew')}</p>
            <div className="update-dialog__notes">{state.releaseNotes}</div>
          </>
        )}
      </Dialog>
    )
  }

  // ── Downloading: progress bar (not dismissible) ───────────────────────
  if (state.status === 'downloading') {
    return (
      <Dialog
        isOpen
        onClose={noop}
        title={t('update.downloading.title')}
        width="460px"
      >
        <p className="update-dialog__body">
          {t('update.downloading.body', { version: state.version })}
        </p>
        <div className="update-dialog__progress">
          <div
            className="update-dialog__progress-bar"
            style={{ width: `${state.percent}%` }}
          />
        </div>
        <p className="update-dialog__percent">{state.percent}%</p>
      </Dialog>
    )
  }

  // ── Ready: prompt to restart ──────────────────────────────────────────
  if (state.status === 'ready') {
    return (
      <Dialog
        isOpen
        onClose={onDismiss}
        title={t('update.ready.title')}
        width="460px"
        actions={
          <>
            <Button onClick={onDismiss}>{t('update.later')}</Button>
            <Button variant="primary" onClick={onInstall}>{t('update.restart')}</Button>
          </>
        }
      >
        <p className="update-dialog__body">
          {t('update.ready.body', { version: state.version })}
        </p>
      </Dialog>
    )
  }

  // ── Error: show error with retry ──────────────────────────────────────
  if (state.status === 'error') {
    return (
      <Dialog
        isOpen
        onClose={onDismiss}
        title={t('update.error.title')}
        width="460px"
        actions={
          <>
            <Button onClick={onDismiss}>{t('update.later')}</Button>
            <Button variant="primary" onClick={onRetry}>{t('update.error.retry')}</Button>
          </>
        }
      >
        <p className="update-dialog__body">
          {t('update.error.body')}
        </p>
        <div className="update-dialog__error-detail">{state.message}</div>
      </Dialog>
    )
  }

  return null
}
