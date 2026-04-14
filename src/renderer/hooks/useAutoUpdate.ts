// ---------------------------------------------------------------------------
// useAutoUpdate - thin adapter over the Zustand updater store
// ---------------------------------------------------------------------------
//
// Dev testing: in the browser console, call __simulateUpdate() to walk through
// the full checking -> available -> downloading -> ready flow.

import { useUpdaterStore } from '@/store/updater'
export type { UpdateState } from '@/store/updater'

/** Safety timeout - if no response within 30s, assume something went wrong. */
const CHECK_TIMEOUT_MS = 30_000

/** Simulated check delay in dev mode so the spinner is visible. */
const DEV_CHECK_DELAY_MS = 1_500

export function useAutoUpdate() {
  const state = useUpdaterStore((s) => s.state)
  const dispatch = useUpdaterStore((s) => s.dispatch)

  return {
    state,
    download: () => {
      dispatch({ type: 'startDownload' })
      window.api.updater.download()
    },
    install: () => window.api.updater.install(),
    dismiss: () => dispatch({ type: 'dismiss' }),
    retry: () => dispatch({ type: 'retry' }),
    checkForUpdates: async () => {
      dispatch({ type: 'check' })
      console.log('[updater] Dispatched check action')

      const initiated = await window.api.updater.check()
      console.log('[updater] Main process responded, initiated:', initiated)

      if (!initiated) {
        // Dev mode - simulate a brief check then show up-to-date
        console.log('[updater] Dev mode: simulating check delay')
        setTimeout(() => {
          const current = useUpdaterStore.getState().state
          if (current.status === 'checking') {
            console.log('[updater] Dev mode: transitioning to upToDate')
            dispatch({ type: 'upToDate' })
          }
        }, DEV_CHECK_DELAY_MS)
        return
      }

      // Safety timeout: if electron-updater hangs, don't spin forever
      setTimeout(() => {
        const current = useUpdaterStore.getState().state
        if (current.status === 'checking') {
          console.warn('[updater] Check timed out after', CHECK_TIMEOUT_MS, 'ms')
          dispatch({ type: 'error', message: 'Update check timed out. Please try again.' })
        }
      }, CHECK_TIMEOUT_MS)
    },
  }
}

// ── Dev tools ───────────────────────────────────────────────────────────────
// Usage in console: __simulateUpdate() walks the full flow with delays.
// __simulateUpdate('error') to simulate an error.

if (import.meta.env.DEV) {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).__simulateUpdate = async (scenario = 'success') => {
    const dispatch = useUpdaterStore.getState().dispatch
    console.log('[updater:sim] Starting simulation:', scenario)

    dispatch({ type: 'check' })
    await sleep(1500)

    if (scenario === 'error') {
      dispatch({ type: 'error', message: 'Simulated network error' })
      return
    }

    if (scenario === 'upToDate') {
      dispatch({ type: 'upToDate' })
      return
    }

    dispatch({
      type: 'available',
      version: '99.0.0',
      releaseNotes: '- Simulated update\n- For testing the full flow',
    })
    console.log('[updater:sim] Showing available dialog. Call __simulateUpdate() again to continue.')

    await sleep(3000)
    dispatch({ type: 'startDownload' })

    for (let i = 0; i <= 100; i += 10) {
      dispatch({ type: 'progress', percent: i })
      await sleep(200)
    }

    dispatch({ type: 'ready', version: '99.0.0' })
    console.log('[updater:sim] Done! "Restart" dialog should be visible.')
  }
}
