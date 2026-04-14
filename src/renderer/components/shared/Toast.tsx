import { useTranslation } from 'react-i18next'
import type { Toast as ToastType } from '@/store/toasts'

const icons: Record<ToastType['type'], string> = {
  done: '\u2713',         // ✓
  error: '\u2717',        // ✗
  waiting_input: '?'
}

function toastTitleKey(toast: ToastType): string {
  if (toast.type === 'done') return 'toastDone'
  if (toast.type === 'error') return 'toastError'
  if (toast.reason === 'plan_approval') return 'toastPlanReady'
  return 'toastQuestion'
}

interface Props {
  toast: ToastType
  isDismissing: boolean
  isHovered: boolean
  onDismiss: (e: React.MouseEvent) => void
  onClick: () => void
}

export function Toast({ toast, isDismissing, isHovered, onDismiss, onClick }: Props) {
  const { t } = useTranslation('common')

  const titleKey = toastTitleKey(toast)

  return (
    <div
      className={`toast toast--${toast.type}${isDismissing ? ' toast--dismissing' : ''}${isHovered ? ' toast--hovered' : ''}`}
      onClick={onClick}
      role="alert"
    >
      <div className="toast__header">
        <span className="toast__icon">{icons[toast.type]}</span>
        <span className="toast__title">{t(titleKey)}</span>
        <button
          className="toast__dismiss"
          onClick={onDismiss}
          aria-label={t('close')}
        >
          ×
        </button>
      </div>
      <div className="toast__detail">
        {toast.projectName ? `${toast.projectName} / ` : ''}{toast.worktreeBranch} — {toast.sessionName}
      </div>
      {toast.type === 'done' && <div className="toast__progress" />}
    </div>
  )
}

interface GroupedProps {
  type: ToastType['type']
  toasts: ToastType[]
  isDismissing: boolean
  onDismissAll: (e: React.MouseEvent) => void
  onDismissOne: (id: string, e: React.MouseEvent) => void
  onClickSession: (toast: ToastType) => void
}

export function GroupedToast({ type, toasts, isDismissing, onDismissAll, onDismissOne, onClickSession }: GroupedProps) {
  const { t } = useTranslation('common')

  const titleKey = type === 'error' ? 'toastErrorCount' : 'toastWaitingInputCount'

  return (
    <div
      className={`toast toast--${type}${isDismissing ? ' toast--dismissing' : ''}`}
      role="alert"
    >
      <div className="toast__header">
        <span className="toast__icon">{icons[type]}</span>
        <span className="toast__title">{t(titleKey, { count: toasts.length })}</span>
        <button
          className="toast__dismiss"
          onClick={onDismissAll}
          aria-label={t('close')}
        >
          ×
        </button>
      </div>
      <div className="toast__sessions">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="toast__session-row"
            onClick={() => onClickSession(toast)}
          >
            <span className="toast__session-row-text">
              {toast.projectName ? `${toast.projectName} / ` : ''}{toast.worktreeBranch} — {toast.sessionName}
            </span>
            <button
              className="toast__session-dismiss"
              onClick={(e) => onDismissOne(toast.id, e)}
              aria-label={t('close')}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
