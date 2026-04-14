import React, { useEffect, useReducer, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'

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

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error' }
  | {
      status: 'loaded'
      version: string
      arm64: DownloadOption | null
      x64: DownloadOption | null
    }

type Action =
  | { type: 'fetch' }
  | { type: 'error' }
  | {
      type: 'loaded'
      version: string
      arm64: DownloadOption | null
      x64: DownloadOption | null
    }

function reducer(_state: State, action: Action): State {
  switch (action.type) {
    case 'fetch':
      return { status: 'loading' }
    case 'error':
      return { status: 'error' }
    case 'loaded':
      return {
        status: 'loaded',
        version: action.version,
        arm64: action.arm64,
        x64: action.x64,
      }
  }
}

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
  const [state, dispatch] = useReducer(reducer, { status: 'idle' })
  const hasFetched = useRef(false)

  useEffect(() => {
    if (!open || hasFetched.current) return
    hasFetched.current = true

    let cancelled = false
    dispatch({ type: 'fetch' })

    fetch(RELEASES_API)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((data: ReleaseData) => {
        if (cancelled) return
        const parsed = parseDownloadOptions(data)
        dispatch({
          type: 'loaded',
          version: parsed.version,
          arm64: parsed.arm64,
          x64: parsed.x64,
        })
      })
      .catch(() => {
        if (cancelled) return
        hasFetched.current = false // allow retry on next open
        dispatch({ type: 'error' })
      })

    return () => {
      cancelled = true
    }
  }, [open])

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

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

  const isLoading = state.status === 'loading' || state.status === 'idle'
  const isError = state.status === 'error'
  const isLoaded = state.status === 'loaded'

  return createPortal(
    <div className="download-dialog-overlay" onClick={handleBackdropClick}>
      <div className="download-dialog" role="dialog" aria-modal="true">
        <button
          type="button"
          className="download-dialog__close"
          onClick={onClose}
          aria-label="Close"
        >
          <CloseIcon />
        </button>

        <h2 className="download-dialog__title">Download Braid</h2>
        {isLoaded && (
          <span className="download-dialog__version">v{state.version}</span>
        )}
        <p className="download-dialog__desc">
          Choose the version for your Mac's processor.
        </p>

        {isLoading && (
          <div className="download-dialog__loading">
            <Spinner />
            <span>Fetching latest release...</span>
          </div>
        )}

        {isError && (
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

        {isLoaded && (
          <>
            <div className="download-dialog__options">
              {state.arm64 && (
                <a
                  href={state.arm64.url}
                  className="download-dialog__option"
                  onClick={onClose}
                >
                  <div className="download-dialog__option-icon">
                    <ChipIcon />
                  </div>
                  <div className="download-dialog__option-text">
                    <strong>{state.arm64.label}</strong>
                    <span>{state.arm64.subtitle}</span>
                  </div>
                </a>
              )}
              {state.x64 && (
                <a
                  href={state.x64.url}
                  className="download-dialog__option"
                  onClick={onClose}
                >
                  <div className="download-dialog__option-icon">
                    <ChipIcon />
                  </div>
                  <div className="download-dialog__option-text">
                    <strong>{state.x64.label}</strong>
                    <span>{state.x64.subtitle}</span>
                  </div>
                </a>
              )}
            </div>
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
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
