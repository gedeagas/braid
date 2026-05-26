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
// Check agents in batches to avoid spawning 29 login shells simultaneously
const BATCH_SIZE = 5

// ── Module-level singleton cache ─────────────────────────────────────────────

let _detected: AgentCatalogEntry[] = []
let _lastCheckAt = 0
let _checking = false
let _retryCount = 0
const _listeners = new Set<() => void>()

function notify() {
  for (const fn of _listeners) fn()
}

/** Run checkTool in batches of BATCH_SIZE to avoid overwhelming the system */
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
      if (r) {
        console.log('[agentDetection] found: %s (%s)', r.id, r.detectCmd)
        available.push(r)
      }
    }
  }
  return available
}

async function runDetection() {
  const now = Date.now()
  if (_checking || now - _lastCheckAt < RECHECK_THROTTLE_MS) return
  _checking = true
  _lastCheckAt = now

  console.log('[agentDetection] starting detection for %d agents (batch=%d)...', AGENT_CATALOG.length, BATCH_SIZE)

  try {
    const available = await checkAllAgents()

    console.log('[agentDetection] detected %d agents: %s', available.length, available.map(a => a.id).join(', ') || '(none)')

    // If nothing was detected, IPC may not have been ready. Retry.
    if (available.length === 0 && _retryCount < MAX_RETRIES) {
      _retryCount++
      console.log('[agentDetection] zero results, scheduling retry %d/%d in %dms', _retryCount, MAX_RETRIES, INIT_RETRY_DELAY_MS)
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
 */
export function initAgentDetection() {
  console.log('[agentDetection] init called, retryCount=%d', _retryCount)
  runDetection()
  window.addEventListener('focus', () => runDetection())
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
