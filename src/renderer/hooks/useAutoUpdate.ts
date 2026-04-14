// ---------------------------------------------------------------------------
// useAutoUpdate - subscribes to auto-updater IPC events from main process
// ---------------------------------------------------------------------------

import { useEffect, useReducer } from 'react'

// ── State types ─────────────────────────────────────────────────────────────

interface IdleState {
  status: 'idle'
}

interface AvailableState {
  status: 'available'
  version: string
  releaseNotes: string
  dismissed: boolean
}

interface DownloadingState {
  status: 'downloading'
  version: string
  releaseNotes: string
  percent: number
}

interface ReadyState {
  status: 'ready'
  version: string
  dismissed: boolean
}

interface ErrorState {
  status: 'error'
  message: string
}

export type UpdateState =
  | IdleState
  | AvailableState
  | DownloadingState
  | ReadyState
  | ErrorState

// ── Actions ─────────────────────────────────────────────────────────────────

type UpdateAction =
  | { type: 'available'; version: string; releaseNotes: string }
  | { type: 'progress'; percent: number }
  | { type: 'ready'; version: string }
  | { type: 'error'; message: string }
  | { type: 'dismiss' }
  | { type: 'startDownload' }
  | { type: 'retry' }

function updateReducer(state: UpdateState, action: UpdateAction): UpdateState {
  switch (action.type) {
    case 'available':
      return {
        status: 'available',
        version: action.version,
        releaseNotes: action.releaseNotes,
        dismissed: false,
      }
    case 'startDownload':
      if (state.status !== 'available') return state
      return {
        status: 'downloading',
        version: state.version,
        releaseNotes: state.releaseNotes,
        percent: 0,
      }
    case 'progress':
      if (state.status !== 'downloading') return state
      return { ...state, percent: action.percent }
    case 'ready':
      return {
        status: 'ready',
        version: action.version,
        dismissed: false,
      }
    case 'error':
      return { status: 'error', message: action.message }
    case 'dismiss':
      if (state.status === 'available') return { ...state, dismissed: true }
      if (state.status === 'ready') return { ...state, dismissed: true }
      if (state.status === 'error') return { status: 'idle' }
      return state
    case 'retry':
      // Reset to idle - the main process periodic check or an explicit
      // checkForUpdates call will re-trigger the flow.
      return { status: 'idle' }
    default:
      return state
  }
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function useAutoUpdate() {
  const [state, dispatch] = useReducer(updateReducer, { status: 'idle' } as UpdateState)

  useEffect(() => {
    const unsubs = [
      window.api.updater.onUpdateAvailable((info: { version: string; releaseNotes: string }) => {
        dispatch({ type: 'available', version: info.version, releaseNotes: info.releaseNotes })
      }),
      window.api.updater.onDownloadProgress((info: { percent: number }) => {
        dispatch({ type: 'progress', percent: info.percent })
      }),
      window.api.updater.onUpdateDownloaded((info: { version: string }) => {
        dispatch({ type: 'ready', version: info.version })
      }),
      window.api.updater.onError((info: { message: string }) => {
        dispatch({ type: 'error', message: info.message })
      }),
    ]
    return () => unsubs.forEach((fn) => fn())
  }, [])

  return {
    state,
    download: () => {
      dispatch({ type: 'startDownload' })
      window.api.updater.download()
    },
    install: () => window.api.updater.install(),
    dismiss: () => dispatch({ type: 'dismiss' }),
    retry: () => dispatch({ type: 'retry' }),
  }
}
