/**
 * BinaryFilePreview - Renders binary files in the FileViewer.
 * BinaryImagePreview: renders image files as <img> with click-to-lightbox.
 * BinaryPlaceholder: renders non-image binary files with type badge and file size.
 */
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Spinner } from '@/components/ui'
import { ImageLightbox } from '@/components/Center/ImageLightbox'
import { imageMimeType, binaryTypeLabel, formatFileSize } from '@/lib/binaryFile'
import * as ipc from '@/lib/ipc'

export function BinaryImagePreview({ filePath }: { filePath: string }) {
  const { t } = useTranslation('right')
  const [dataUri, setDataUri] = useState<string | null>(null)
  const [fileSize, setFileSize] = useState(0)
  const [loading, setLoading] = useState(true)
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setDataUri(null)

    ipc.git.readFileAsBase64(filePath).then((result) => {
      if (cancelled) return
      if (result) {
        setFileSize(result.size)
        if (result.base64) {
          const mime = imageMimeType(filePath) ?? 'application/octet-stream'
          setDataUri(`data:${mime};base64,${result.base64}`)
        }
      }
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [filePath])

  if (loading) {
    return <div className="binary-diff-loading"><Spinner size="md" /></div>
  }

  return (
    <div className="binary-diff-image">
      {dataUri ? (
        <div className="binary-diff-image-panel">
          <img
            src={dataUri}
            alt={filePath}
            className="binary-diff-image-preview"
            onClick={() => setLightboxSrc(dataUri)}
            title={t('clickToPreview')}
          />
          <span className="binary-diff-image-size">{formatFileSize(fileSize)}</span>
        </div>
      ) : fileSize > 0 ? (
        <div className="binary-diff-placeholder">
          <span className="binary-diff-filename">{filePath.split('/').pop() ?? filePath}</span>
          <span className="binary-diff-size">{formatFileSize(fileSize)}</span>
          <span className="binary-diff-hint">{t('binaryFileCannotDiff')}</span>
        </div>
      ) : null}
      {lightboxSrc && (
        <ImageLightbox src={lightboxSrc} alt={filePath} onClose={() => setLightboxSrc(null)} />
      )}
    </div>
  )
}

export function BinaryPlaceholder({ filePath }: { filePath: string }) {
  const { t } = useTranslation('right')
  const [fileSize, setFileSize] = useState(0)

  useEffect(() => {
    let cancelled = false
    ipc.git.getFileSize(filePath).then((size) => {
      if (!cancelled) setFileSize(size)
    })
    return () => { cancelled = true }
  }, [filePath])

  const label = t(binaryTypeLabel(filePath))
  return (
    <div className="binary-diff-placeholder">
      <span className="binary-diff-type-badge">{label}</span>
      <span className="binary-diff-filename">{filePath.split('/').pop() ?? filePath}</span>
      {fileSize > 0 && <span className="binary-diff-size">{formatFileSize(fileSize)}</span>}
      <span className="binary-diff-hint">{t('binaryFile')}</span>
    </div>
  )
}
