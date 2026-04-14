import { memo, useCallback, useEffect, useReducer, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import * as ipc from '@/lib/ipc'
import { flash } from '@/store/flash'

// ─── Types ───────────────────────────────────────────────────────────────────

interface CaptureSource {
  id: string
  name: string
  appName: string
  thumbnailDataUrl: string
}

type Phase = 'checking' | 'no-permission' | 'loading' | 'source-list' | 'streaming' | 'error'

interface State {
  phase: Phase
  sources: CaptureSource[]
  selectedSource: CaptureSource | null
  error: string | null
}

type Action =
  | { type: 'CHECKING' }
  | { type: 'NO_PERMISSION' }
  | { type: 'LOADING' }
  | { type: 'SOURCES_LOADED'; sources: CaptureSource[] }
  | { type: 'STREAM_STARTED'; source: CaptureSource }
  | { type: 'STREAM_ENDED' }
  | { type: 'ERROR'; error: string }

const initialState: State = {
  phase: 'checking',
  sources: [],
  selectedSource: null,
  error: null,
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'CHECKING':
      return { ...state, phase: 'checking', error: null }
    case 'NO_PERMISSION':
      return { ...state, phase: 'no-permission' }
    case 'LOADING':
      return { ...state, phase: 'loading', error: null }
    case 'SOURCES_LOADED':
      return { ...state, phase: 'source-list', sources: action.sources, error: null }
    case 'STREAM_STARTED':
      return { ...state, phase: 'streaming', selectedSource: action.source }
    case 'STREAM_ENDED':
      return { ...state, phase: 'source-list', selectedSource: null }
    case 'ERROR':
      return { ...state, phase: 'error', error: action.error }
    default:
      return state
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export const WindowCaptureView = memo(function WindowCaptureView({
  isActive,
}: {
  isActive: boolean
}) {
  const { t } = useTranslation('right')
  const [state, dispatch] = useReducer(reducer, initialState)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // Stop any active stream tracks
  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  // Attempt getSources first — this triggers macOS to register the app in
  // Screen Recording preferences. Only show permission UI if sources come back
  // empty AND the permission is explicitly denied.
  const initialize = useCallback(async () => {
    dispatch({ type: 'LOADING' })
    try {
      const sources = await ipc.windowCapture.getSources()
      if (sources.length === 0) {
        const permission = await ipc.windowCapture.checkPermission()
        if (permission === 'denied' || permission === 'restricted') {
          dispatch({ type: 'NO_PERMISSION' })
          return
        }
      }
      dispatch({ type: 'SOURCES_LOADED', sources })
    } catch (err) {
      dispatch({ type: 'ERROR', error: String(err) })
    }
  }, [])

  // Refresh source list only
  const refreshSources = useCallback(async () => {
    try {
      const sources = await ipc.windowCapture.getSources()
      dispatch({ type: 'SOURCES_LOADED', sources })
    } catch {
      /* ignore polling errors */
    }
  }, [])

  // Start capturing a window source.
  // Flow: tell main process which source we want → call getDisplayMedia →
  // main's setDisplayMediaRequestHandler matches the pending ID and grants it.
  const startCapture = useCallback(
    async (source: CaptureSource) => {
      try {
        // Tell main process which source to grant
        console.log('[WinCapture] selectSource:', source.id, source.name)
        await ipc.windowCapture.selectSource(source.id)

        console.log('[WinCapture] Calling getDisplayMedia...')
        const stream = await navigator.mediaDevices.getDisplayMedia({
          audio: false,
          video: true,
        })

        const tracks = stream.getVideoTracks()
        console.log('[WinCapture] Got stream, video tracks:', tracks.length)
        tracks.forEach((t, i) => {
          const s = t.getSettings()
          console.log(`[WinCapture] Track ${i}:`, t.label, t.readyState, `${s.width}x${s.height}`, `fps=${s.frameRate}`)
        })

        streamRef.current = stream

        // Listen for external track end (e.g. source window closed)
        tracks[0]?.addEventListener('ended', () => {
          console.log('[WinCapture] Track ended externally')
          streamRef.current = null
          dispatch({ type: 'STREAM_ENDED' })
        })

        // Dispatch first so StreamingView mounts the <video> element;
        // a useEffect below will assign srcObject once the ref is ready.
        dispatch({ type: 'STREAM_STARTED', source })
      } catch (err) {
        console.error('[WinCapture] startCapture error:', err)
        dispatch({ type: 'ERROR', error: String(err) })
      }
    },
    []
  )

  // Disconnect: stop stream → go back to source list
  const disconnect = useCallback(() => {
    stopStream()
    dispatch({ type: 'STREAM_ENDED' })
  }, [stopStream])

  // Touch forwarding — map CSS click position on <video> to relative 0–1 coords.
  // The video uses object-fit:contain, so we account for letterbox/pillarbox offsets.
  const handleVideoClick = useCallback(async (e: React.MouseEvent<HTMLVideoElement>) => {
    const video = videoRef.current
    if (!video || !state.selectedSource) return
    const { videoWidth, videoHeight } = video
    if (!videoWidth || !videoHeight) return

    const rect = video.getBoundingClientRect()
    const vidAspect = videoWidth / videoHeight
    const containerAspect = rect.width / rect.height

    let renderW: number, renderH: number, offsetX: number, offsetY: number
    if (containerAspect > vidAspect) {
      renderH = rect.height; renderW = renderH * vidAspect
      offsetX = (rect.width - renderW) / 2; offsetY = 0
    } else {
      renderW = rect.width; renderH = renderW / vidAspect
      offsetX = 0; offsetY = (rect.height - renderH) / 2
    }

    const relX = (e.clientX - rect.left - offsetX) / renderW
    const relY = (e.clientY - rect.top - offsetY) / renderH
    if (relX < 0 || relX > 1 || relY < 0 || relY > 1) return

    const result = await ipc.windowCapture.tap(state.selectedSource.id, relX, relY)
    if (result === 'no-accessibility') {
      flash('warning', t('windowCaptureAccessibilityRequired'))
    }
  }, [state.selectedSource, t])

  // Assign the MediaStream to the <video> element once StreamingView mounts.
  // The phase transition to 'streaming' causes React to render <video>,
  // and this effect fires after that render with the ref now pointing to a live DOM node.
  useEffect(() => {
    if (state.phase === 'streaming' && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current
      console.log('[WinCapture] srcObject assigned to mounted <video>')
    }
  }, [state.phase])

  // Initialize on first active
  useEffect(() => {
    if (isActive) initialize()
  }, [isActive, initialize])

  // Poll sources every 3s while on source-list phase & active
  useEffect(() => {
    if (!isActive || state.phase !== 'source-list') return
    const id = setInterval(refreshSources, 3000)
    return () => clearInterval(id)
  }, [isActive, state.phase, refreshSources])

  // Re-check permission on window focus (after user returns from System Preferences)
  useEffect(() => {
    if (state.phase !== 'no-permission') return
    const onFocus = () => initialize()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [state.phase, initialize])

  // Cleanup stream on unmount
  useEffect(() => () => stopStream(), [stopStream])

  return (
    <div className="wincap-view">
      {state.phase === 'checking' && <CheckingView t={t} />}
      {state.phase === 'no-permission' && <PermissionView t={t} />}
      {state.phase === 'loading' && <LoadingView t={t} />}
      {state.phase === 'source-list' && (
        <SourceListView
          t={t}
          sources={state.sources}
          onCapture={startCapture}
          onRefresh={refreshSources}
        />
      )}
      {state.phase === 'streaming' && (
        <StreamingView
          t={t}
          videoRef={videoRef}
          sourceName={state.selectedSource?.name ?? ''}
          onDisconnect={disconnect}
          onVideoClick={handleVideoClick}
        />
      )}
      {state.phase === 'error' && <ErrorView t={t} error={state.error} onRetry={initialize} />}
    </div>
  )
})

// ─── Sub-views ───────────────────────────────────────────────────────────────

type TFn = (key: string) => string

function CheckingView({ t: _t }: { t: TFn }) {
  return (
    <div className="wincap-centered">
      <span className="wincap-loading-text">…</span>
    </div>
  )
}

function PermissionView({ t }: { t: TFn }) {
  return (
    <div className="wincap-centered">
      <span className="wincap-empty-title">{t('windowCapturePermissionRequired')}</span>
      <span className="wincap-empty-hint">{t('windowCapturePermissionHint')}</span>
      <button
        className="wincap-action-btn wincap-connect-btn"
        style={{ marginTop: 8 }}
        onClick={() => ipc.windowCapture.openPermissionSettings()}
      >
        {t('windowCaptureOpenSettings')}
      </button>
    </div>
  )
}

function LoadingView({ t }: { t: TFn }) {
  return (
    <div className="wincap-centered">
      <span className="wincap-loading-text">{t('windowCaptureLoading')}</span>
    </div>
  )
}

function SourceListView({
  t,
  sources,
  onCapture,
  onRefresh,
}: {
  t: TFn
  sources: CaptureSource[]
  onCapture: (source: CaptureSource) => void
  onRefresh: () => void
}) {
  if (sources.length === 0) {
    return (
      <div className="wincap-centered">
        <span className="wincap-empty-title">{t('windowCaptureNoSources')}</span>
        <span className="wincap-empty-hint">{t('windowCaptureNoSourcesHint')}</span>
        <button className="wincap-action-btn" style={{ marginTop: 8 }} onClick={onRefresh}>
          {t('windowCaptureRefresh')}
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="wincap-list-header">
        <span className="wincap-list-title">{t('windowCaptureTab')}</span>
        <button className="wincap-action-btn" onClick={onRefresh}>
          {t('windowCaptureRefresh')}
        </button>
      </div>
      <div className="wincap-source-list">
        {sources.map((source) => (
          <div key={source.id} className="wincap-source-item">
            <img className="wincap-thumbnail" src={source.thumbnailDataUrl} alt={source.name} />
            <div className="wincap-source-info">
              <span className="wincap-source-name">{source.name}</span>
              <span className="wincap-source-app">{source.appName}</span>
            </div>
            <button
              className="wincap-action-btn wincap-connect-btn"
              onClick={() => onCapture(source)}
            >
              {t('windowCaptureCapture')}
            </button>
          </div>
        ))}
      </div>
    </>
  )
}

function StreamingView({
  t,
  videoRef,
  sourceName,
  onDisconnect,
  onVideoClick,
}: {
  t: TFn
  videoRef: React.RefObject<HTMLVideoElement | null>
  sourceName: string
  onDisconnect: () => void
  onVideoClick: (e: React.MouseEvent<HTMLVideoElement>) => void
}) {
  return (
    <>
      <div className="wincap-header">
        <span className="wincap-header-name">{sourceName}</span>
        <button className="wincap-action-btn wincap-disconnect-btn" onClick={onDisconnect}>
          {t('windowCaptureStop')}
        </button>
      </div>
      <div className="wincap-stream-container">
        <video
          ref={videoRef}
          className="wincap-video"
          autoPlay
          playsInline
          muted
          onClick={onVideoClick}
          style={{ cursor: 'pointer' }}
        />
      </div>
    </>
  )
}

function ErrorView({
  t,
  error,
  onRetry,
}: {
  t: TFn
  error: string | null
  onRetry: () => void
}) {
  return (
    <div className="wincap-centered">
      <span className="wincap-error-text">{error ?? t('windowCaptureError')}</span>
      <button className="wincap-action-btn" style={{ marginTop: 8 }} onClick={onRetry}>
        {t('windowCaptureRefresh')}
      </button>
    </div>
  )
}
