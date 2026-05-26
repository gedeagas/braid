/**
 * Auto-detect which CLI agents from the catalog are installed on PATH.
 * Uses the existing shell:checkTool IPC to probe each binary.
 *
 * Detection starts eagerly via initAgentDetection() called from App.tsx,
 * so results are ready before the user ever opens the + menu. A simple
 * pub/sub cache lets React components subscribe without redundant IPC calls.
 */
import { useSyncExternalStore } from 'react'
import { AGENT_CATALOG, type AgentCatalogEntry } from './agentCatalog'
import { shell } from './ipc'

const RECHECK_THROTTLE_MS = 60_000
const INIT_RETRY_DELAY_MS = 3_000
const MAX_RETRIES = 3
// Check agents in batches to limit concurrent IPC calls
const BATCH_SIZE = 5

// ── Module-level singleton cache ─────────────────────────────────────────────

let _detected: AgentCatalogEntry[] = []
let _lastCheckAt = 0
let _checking = false
let _retryCount = 0
let _initialized = false
const _listeners = new Set<() => void>()

function notify() {
  for (const fn of _listeners) fn()
}

/** Run checkTool in batches of BATCH_SIZE to limit concurrent IPC calls */
async function checkAllAgents(): Promise<AgentCatalogEntry[]> {
  const available: AgentCatalogEntry[] = []
  for (let i = 0; i < AGENT_CATALOG.length; i += BATCH_SIZE) {
    const batch = AGENT_CATALOG.slice(i, i + BATCH_SIZE)
    const results = await Promise.all(
      batch.map(async (entry) => {
        try {
          const found = await shell.checkTool(entry.detectCmd)
          return found ? entry : null
        } catch (err) {
          console.warn('[agentDetection] checkTool error for %s:', entry.detectCmd, err)
          return null
        }
      })
    )
    for (const r of results) {
      if (r) available.push(r)
    }
  }
  return available
}

async function runDetection() {
  const now = Date.now()
  if (_checking || now - _lastCheckAt < RECHECK_THROTTLE_MS) return
  _checking = true
  _lastCheckAt = now

  try {
    const available = await checkAllAgents()

    // If nothing was detected, IPC may not have been ready. Retry.
    if (available.length === 0 && _retryCount < MAX_RETRIES) {
      _retryCount++
      _checking = false
      _lastCheckAt = 0
      setTimeout(() => runDetection(), INIT_RETRY_DELAY_MS)
      return
    }

    _detected = available
    notify()
  } finally {
    _checking = false
  }
}

/**
 * Call once from App.tsx to kick off agent detection at boot.
 * Also installs a window focus listener for re-checks (throttled to 60s).
 * Returns a cleanup function to remove the listener on unmount.
 * Idempotent - safe to call multiple times (React StrictMode).
 */
export function initAgentDetection(): () => void {
  if (!_initialized) {
    _initialized = true
    runDetection()
  }
  const handler = () => runDetection()
  window.addEventListener('focus', handler)
  return () => window.removeEventListener('focus', handler)
}

// ── React hook ───────────────────────────────────────────────────────────────

function subscribe(cb: () => void) {
  _listeners.add(cb)
  return () => _listeners.delete(cb)
}

function getSnapshot(): AgentCatalogEntry[] {
  return _detected
}

/**
 * Returns the subset of AGENT_CATALOG entries whose CLI binary is found on PATH.
 * Results are available immediately if detection has already completed.
 * Re-checks on window focus (throttled to once per 60s).
 */
export function useDetectedAgents(): AgentCatalogEntry[] {
  return useSyncExternalStore(subscribe, getSnapshot)
}
