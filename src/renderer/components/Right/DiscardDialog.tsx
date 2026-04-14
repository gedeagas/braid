import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { basename } from '@/lib/diffUtils'
import { Dialog, Button } from '@/components/ui'

interface DiscardFile {
  file: string
  status: string
}

interface Props {
  files: DiscardFile[]
  onConfirm: () => void
  onCancel: () => void
}

export function DiscardDialog({ files, onConfirm, onCancel }: Props) {
  const { t } = useTranslation('right')
  const isSingle = files.length === 1

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') onConfirm()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onConfirm])

  const title = isSingle
    ? t('discardDialogTitle', { file: basename(files[0].file) })
    : t('discardAllDialogTitle', { count: files.length })

  return (
    <Dialog
      isOpen
      onClose={onCancel}
      title={title}
      actions={
        <>
          <Button onClick={onCancel}>{t('cancel', { ns: 'common' })}</Button>
          <Button variant="danger" onClick={onConfirm}>
            {isSingle ? t('discard') : t('discardAll')}
          </Button>
        </>
      }
    >
      {!isSingle && (
        <div className="discard-dialog-file-list">
          {files.slice(0, 8).map((f) => (
            <div key={f.file} className="discard-dialog-file-item">
              {basename(f.file)}
            </div>
          ))}
          {files.length > 8 && (
            <div className="discard-dialog-file-item discard-dialog-file-item--more">
              {t('discardDialogMore', { count: files.length - 8 })}
            </div>
          )}
        </div>
      )}
      <p className="discard-dialog-hint">{t('discardConfirmHint')}</p>
    </Dialog>
  )
}
