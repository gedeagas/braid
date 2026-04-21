// ---------------------------------------------------------------------------
// Updater store - shared auto-update state via Zustand
// ---------------------------------------------------------------------------
//
// State types and reducer lifted from useAutoUpdate hook so both App.tsx
// (UpdateDialog) and SettingsAbout (Check for Updates button) share a single
// source of truth with zero duplicate IPC subscriptions.

import { create } from 'zustand'

// ── State types ─────────────────────────────────────────────────────────────

interface IdleState { status: 'idle' }
interface CheckingState { status: 'checking' }
interface AvailableState { status: 'available'; version: string; releaseNotes: string; dismissed: boolean }
interface DownloadingState { status: 'downloading'; version: string; releaseNotes: string; percent: number }
interface ReadyState { status: 'ready'; version: string; dismissed: boolean }
interface ErrorState { status: 'error'; message: string }
interface UpToDateState { status: 'upToDate' }

export type UpdateState =
  | IdleState
  | CheckingState
  | AvailableState
  | DownloadingState
  | ReadyState
  | ErrorState
  | UpToDateState

// ── Actions ─────────────────────────────────────────────────────────────────

type UpdateAction =
  | { type: 'available'; version: string; releaseNotes: string }
  | { type: 'progress'; percent: number }
  | { type: 'ready'; version: string }
  | { type: 'error'; message: string }
  | { type: 'dismiss' }
  | { type: 'undismiss' }
  | { type: 'startDownload' }
  | { type: 'retry' }
  | { type: 'check' }
  | { type: 'upToDate' }

function updateReducer(state: UpdateState, action: UpdateAction): UpdateState {
  switch (action.type) {
    case 'available': {
      // Don't downgrade from ready → available for the same version: the update
      // is already downloaded and we'd lose that state on the next periodic check.
      if (state.status === 'ready' && state.version === action.version) return state
      // Keep dismissed=true if the user already skipped this exact version
      const alreadyDismissed =
        (state.status === 'available' || state.status === 'ready') &&
        state.dismissed &&
        state.version === action.version
      return {
        status: 'available',
        version: action.version,
        releaseNotes: action.releaseNotes,
        dismissed: alreadyDismissed,
      }
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
      return { status: 'ready', version: action.version, dismissed: false }
    case 'error':
      return { status: 'error', message: action.message }
    case 'dismiss':
      if (state.status === 'available') return { ...state, dismissed: true }
      if (state.status === 'ready') return { ...state, dismissed: true }
      if (state.status === 'error') return { status: 'idle' }
      return state
    case 'undismiss':
      if (state.status === 'available') return { ...state, dismissed: false }
      if (state.status === 'ready') return { ...state, dismissed: false }
      return state
    case 'retry':
      return { status: 'idle' }
    case 'check':
      if (state.status === 'idle' || state.status === 'upToDate' || state.status === 'error') {
        return { status: 'checking' }
      }
      return state
    case 'upToDate':
      if (state.status === 'checking' || state.status === 'idle') {
        return { status: 'upToDate' }
      }
      return state
    default:
      return state
  }
}

// ── Store ───────────────────────────────────────────────────────────────────

interface UpdaterStore {
  state: UpdateState
  dispatch: (action: UpdateAction) => void
}

export const useUpdaterStore = create<UpdaterStore>((set, get) => ({
  state: { status: 'idle' },
  dispatch: (action) => set({ state: updateReducer(get().state, action) }),
}))

// ── IPC listener initialization (call once from App.tsx) ────────────────────

export function initUpdateListeners(): () => void {
  const dispatch = useUpdaterStore.getState().dispatch
  console.log('[updater] Initializing IPC listeners')
  const unsubs = [
    window.api.updater.onUpdateAvailable((info: { version: string; releaseNotes: string }) => {
      console.log('[updater] IPC: update-available', info.version)
      dispatch({ type: 'available', version: info.version, releaseNotes: info.releaseNotes })
    }),
    window.api.updater.onDownloadProgress((info: { percent: number }) => {
      dispatch({ type: 'progress', percent: info.percent })
    }),
    window.api.updater.onUpdateDownloaded((info: { version: string }) => {
      console.log('[updater] IPC: update-downloaded', info.version)
      dispatch({ type: 'ready', version: info.version })
    }),
    window.api.updater.onError((info: { message: string }) => {
      console.error('[updater] IPC: error', info.message)
      dispatch({ type: 'error', message: info.message })
    }),
    window.api.updater.onUpToDate(() => {
      console.log('[updater] IPC: up-to-date')
      dispatch({ type: 'upToDate' })
    }),
  ]
  return () => unsubs.forEach((fn) => fn())
}
