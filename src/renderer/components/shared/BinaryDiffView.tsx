/**
 * BinaryDiffView - Renders binary file diffs.
 * For images: shows inline preview with click-to-lightbox.
 * For non-image binary: shows metadata placeholder (type badge + file size).
 *
 * Security note: SVG files are rendered via <img> tags only. This prevents
 * embedded scripts from executing. Never render SVG data URIs with innerHTML,
 * <object>, or <iframe>.
 */
import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Spinner } from '@/components/ui'
import { ImageLightbox } from '@/components/Center/ImageLightbox'
import { isImageFile, imageMimeType, binaryTypeLabel, formatFileSize } from '@/lib/binaryFile'
import * as ipc from '@/lib/ipc'

interface BinaryDiffViewProps {
  /** Relative path within worktree (for display and extension detection) */
  filePath: string
  /** Absolute worktree path */
  worktreePath: string
  /** Git change status */
  status: 'A' | 'M' | 'D' | '?' | 'R'
  /** Whether the change is staged */
  staged: boolean
}

export function BinaryDiffView({ filePath, worktreePath, status }: BinaryDiffViewProps) {
  const { t } = useTranslation('right')
  const isImage = isImageFile(filePath)
  const [loading, setLoading] = useState(true)
  const [dataUri, setDataUri] = useState<string | null>(null)
  const [fileSize, setFileSize] = useState(0)
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setDataUri(null)
    setFileSize(0)

    const fullPath = `${worktreePath}/${filePath}`

    async function load() {
      if (isImage && status !== 'D') {
        // Load image content for preview
        const result = await ipc.git.readFileAsBase64(fullPath)
        if (cancelled) return
        if (result) {
          setFileSize(result.size)
          if (result.base64) {
            const mime = imageMimeType(filePath) ?? 'application/octet-stream'
            setDataUri(`data:${mime};base64,${result.base64}`)
          }
        }
      } else if (status !== 'D') {
        // Non-image binary: just get size (lightweight call)
        const size = await ipc.git.getFileSize(fullPath)
        if (cancelled) return
        setFileSize(size)
      }
      if (!cancelled) setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [filePath, worktreePath, status, isImage])

  const handleImageClick = useCallback((src: string) => {
    setLightboxSrc(src)
  }, [])

  if (loading) {
    return (
      <div className="binary-diff-loading">
        <Spinner size="md" />
        <span>{t('loadingDiff')}</span>
      </div>
    )
  }

  // Non-image binary: metadata placeholder
  if (!isImage) {
    const label = t(binaryTypeLabel(filePath))
    return (
      <div className="binary-diff-placeholder">
        <span className="binary-diff-type-badge">{label}</span>
        <span className="binary-diff-filename">{filePath}</span>
        {fileSize > 0 && <span className="binary-diff-size">{formatFileSize(fileSize)}</span>}
        <span className="binary-diff-hint">{t('binaryFileCannotDiff')}</span>
      </div>
    )
  }

  // Image: deleted
  if (status === 'D') {
    return (
      <div className="binary-diff-image">
        <div className="binary-diff-image-panel binary-diff-image-panel--deleted">
          <span className="binary-diff-image-label">{t('binaryImageDeleted')}</span>
          <span className="binary-diff-hint">{filePath}</span>
        </div>
      </div>
    )
  }

  // Image: new or modified - show preview (or "too large" if base64 was null)
  return (
    <div className="binary-diff-image">
      <div className="binary-diff-image-panel">
        {status === 'M' && <span className="binary-diff-image-label">{t('binaryImageCurrent')}</span>}
        {dataUri ? (
          <>
            <img
              src={dataUri}
              alt={filePath}
              className="binary-diff-image-preview"
              onClick={() => handleImageClick(dataUri)}
              title={t('clickToPreview')}
            />
            <span className="binary-diff-image-size">{formatFileSize(fileSize)}</span>
          </>
        ) : fileSize > 0 ? (
          <div className="binary-diff-placeholder">
            <span className="binary-diff-filename">{filePath}</span>
            <span className="binary-diff-size">{formatFileSize(fileSize)}</span>
            <span className="binary-diff-hint">{t('binaryFileCannotDiff')}</span>
          </div>
        ) : null}
      </div>
      {lightboxSrc && (
        <ImageLightbox
          src={lightboxSrc}
          alt={filePath}
          onClose={() => setLightboxSrc(null)}
        />
      )}
    </div>
  )
}
