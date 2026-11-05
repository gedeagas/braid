import { useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Dialog } from '@/components/ui'
import { useConfirmStore } from '@/store/confirm'

/** Renders the oldest pending confirmDialog() request. Mount once at the app root. */
export function ConfirmDialogHost() {
  const { t } = useTranslation('common')
  const request = useConfirmStore((s) => s.queue[0])
  const settle = useConfirmStore((s) => s.settle)
  const confirmRef = useRef<HTMLButtonElement>(null)

  const id = request?.id
  const cancel = useCallback(() => { if (id) settle(id, false) }, [id, settle])
  const accept = useCallback(() => { if (id) settle(id, true) }, [id, settle])

  if (!request) return null
  const { title, message, confirmLabel, cancelLabel, destructive } = request.options

  return (
    <Dialog
      // Remount per request so focus restore and initial focus run for each one
      key={request.id}
      isOpen
      onClose={cancel}
      title={title}
      className="confirm-dialog"
      initialFocusRef={confirmRef}
      actions={
        <>
          <Button onClick={cancel}>{cancelLabel ?? t('cancel')}</Button>
          <Button ref={confirmRef} variant={destructive ? 'danger' : 'primary'} onClick={accept}>
            {confirmLabel ?? t('confirm')}
          </Button>
        </>
      }
    >
      <p className={title ? 'confirm-dialog__message' : 'confirm-dialog__message confirm-dialog__message--solo'}>
        {message}
      </p>
    </Dialog>
  )
}
