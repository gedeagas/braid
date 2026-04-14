import React, { useEffect, useState, useCallback } from 'react'

interface ReleaseAsset {
  name: string
  browser_download_url: string
}

interface ReleaseData {
  tag_name: string
  assets: ReleaseAsset[]
}

interface DownloadOption {
  label: string
  subtitle: string
  url: string
}

const RELEASES_API =
  'https://api.github.com/repos/gedeagas/braid/releases/latest'
const RELEASES_PAGE = 'https://github.com/gedeagas/braid/releases/latest'

function parseDownloadOptions(data: ReleaseData): {
  version: string
  arm64: DownloadOption | null
  x64: DownloadOption | null
} {
  const version = data.tag_name.replace(/^v/, '')
  let arm64: DownloadOption | null = null
  let x64: DownloadOption | null = null

  for (const asset of data.assets) {
    if (asset.name.endsWith('-arm64.dmg')) {
      arm64 = {
        label: 'Apple Silicon',
        subtitle: 'M1, M2, M3, M4 - recommended for most Macs',
        url: asset.browser_download_url,
      }
    } else if (asset.name.endsWith('-x64.dmg')) {
      x64 = {
        label: 'Intel',
        subtitle: 'For older Macs (pre-2020)',
        url: asset.browser_download_url,
      }
    }
  }

  return { version, arm64, x64 }
}

function ChipIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
      <path d="M9 2v2" />
      <path d="M15 2v2" />
      <path d="M9 20v2" />
      <path d="M15 20v2" />
      <path d="M2 9h2" />
      <path d="M2 15h2" />
      <path d="M20 9h2" />
      <path d="M20 15h2" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

function Spinner() {
  return <div className="download-dialog__spinner" />
}

interface Props {
  open: boolean
  onClose: () => void
}

export default function DownloadDialog({ open, onClose }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [version, setVersion] = useState('')
  const [arm64, setArm64] = useState<DownloadOption | null>(null)
  const [x64, setX64] = useState<DownloadOption | null>(null)

  useEffect(() => {
    if (!open || version) return

    let cancelled = false
    setLoading(true)
    setError(false)

    fetch(RELEASES_API)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((data: ReleaseData) => {
        if (cancelled) return
        const parsed = parseDownloadOptions(data)
        setVersion(parsed.version)
        setArm64(parsed.arm64)
        setX64(parsed.x64)
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setError(true)
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [open, version])

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose()
    },
    [onClose],
  )

  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="download-dialog-overlay" onClick={handleBackdropClick}>
      <div className="download-dialog" role="dialog" aria-modal="true">
        <button
          className="download-dialog__close"
          onClick={onClose}
          aria-label="Close"
        >
          <CloseIcon />
        </button>

        <h2 className="download-dialog__title">Download Braid</h2>
        {version && (
          <span className="download-dialog__version">v{version}</span>
        )}
        <p className="download-dialog__desc">
          Choose the version for your Mac's processor.
        </p>

        {loading && (
          <div className="download-dialog__loading">
            <Spinner />
            <span>Fetching latest release...</span>
          </div>
        )}

        {error && (
          <div className="download-dialog__error">
            <p>Could not fetch release info.</p>
            <a
              href={RELEASES_PAGE}
              target="_blank"
              rel="noopener noreferrer"
              className="button button--primary"
            >
              View releases on GitHub
            </a>
          </div>
        )}

        {!loading && !error && (
          <div className="download-dialog__options">
            {arm64 && (
              <a
                href={arm64.url}
                className="download-dialog__option"
                onClick={onClose}
              >
                <div className="download-dialog__option-icon">
                  <ChipIcon />
                </div>
                <div className="download-dialog__option-text">
                  <strong>{arm64.label}</strong>
                  <span>{arm64.subtitle}</span>
                </div>
              </a>
            )}
            {x64 && (
              <a
                href={x64.url}
                className="download-dialog__option"
                onClick={onClose}
              >
                <div className="download-dialog__option-icon">
                  <ChipIcon />
                </div>
                <div className="download-dialog__option-text">
                  <strong>{x64.label}</strong>
                  <span>{x64.subtitle}</span>
                </div>
              </a>
            )}
          </div>
        )}

        <p className="download-dialog__hint">
          Not sure?{' '}
          <a
            href="https://support.apple.com/en-us/116943"
            target="_blank"
            rel="noopener noreferrer"
          >
            Check your Mac's chip
          </a>
        </p>
      </div>
    </div>
  )
}
