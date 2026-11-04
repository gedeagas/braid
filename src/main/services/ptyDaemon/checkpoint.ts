/**
 * Periodic checkpointing of PTY sessions to disk.
 *
 * Checkpoints are written atomically (write to .tmp, rename) every 5 seconds.
 * Used for cold restore when the daemon dies and a new one starts.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'fs'
import { join } from 'path'
import { CHECKPOINT_DIR, CHECKPOINT_INTERVAL_MS } from './protocol'
import type { SessionHost } from './sessionHost'
import type { CheckpointData } from './types'

let intervalHandle: ReturnType<typeof setInterval> | null = null

/**
 * What each checkpoint file last held, minus the timestamp. Idle terminals
 * produce identical checkpoints every tick; skipping those avoids rewriting
 * megabytes of scrollback every 5 seconds.
 */
const lastWritten = new Map<string, string>()

/**
 * Sessions killed by a signal while this daemon kept running. Their
 * checkpoint must survive the stale-file cleanup so the next daemon can
 * restore them (see shouldDropCheckpointOnExit).
 */
const retained = new Set<string>()

/** Keep a dead session's checkpoint on disk for the next daemon start. */
export function retainCheckpoint(sessionId: string): void {
  retained.add(safeFileName(sessionId))
}

function signature(cp: CheckpointData): string {
  return JSON.stringify([cp.scrollback.length, cp.lastOutputAt, cp.cols, cp.rows, cp.cwd, cp.metadata, cp.env, cp.foreground])
}

/** Start periodic checkpointing. */
export function startCheckpointing(host: SessionHost): void {
  if (intervalHandle) return

  mkdirSync(CHECKPOINT_DIR, { recursive: true, mode: 0o700 })

  intervalHandle = setInterval(() => {
    // Sample only on the periodic tick; the shutdown flush must not resample.
    host.sampleForeground()
    flushCheckpoints(host)
  }, CHECKPOINT_INTERVAL_MS)

  // Don't keep the process alive just for checkpointing
  if (intervalHandle && typeof intervalHandle === 'object' && 'unref' in intervalHandle) {
    intervalHandle.unref()
  }
}

/** Stop periodic checkpointing. */
export function stopCheckpointing(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle)
    intervalHandle = null
  }
}

/**
 * Write all changed session checkpoints to disk atomically. `force` rewrites
 * every one (final flush on shutdown).
 */
export function flushCheckpoints(host: SessionHost, opts: { force?: boolean } = {}): void {
  const checkpoints = host.getCheckpoints()
  const activeIds = new Set(checkpoints.map((cp) => cp.sessionId))

  mkdirSync(CHECKPOINT_DIR, { recursive: true, mode: 0o700 })

  // Write active session checkpoints
  for (const cp of checkpoints) {
    const sig = signature(cp)
    if (!opts.force && lastWritten.get(cp.sessionId) === sig) continue
    if (writeCheckpoint(cp)) lastWritten.set(cp.sessionId, sig)
  }
  for (const id of lastWritten.keys()) {
    if (!activeIds.has(id)) lastWritten.delete(id)
  }

  // Remove checkpoints for sessions that no longer exist
  try {
    const files = readdirSync(CHECKPOINT_DIR)
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      const sessionId = file.replace(/\.json$/, '')
      if (!activeIds.has(sessionId) && !retained.has(safeFileName(sessionId))) {
        try {
          unlinkSync(join(CHECKPOINT_DIR, file))
        } catch {
          // Best effort
        }
      }
    }
  } catch {
    // CHECKPOINT_DIR might not exist yet
  }
}

/** Sanitize a session ID for safe use in file paths. */
function safeFileName(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9-]/g, '_')
}

/** Write a single checkpoint atomically. Returns whether it was written. */
function writeCheckpoint(data: CheckpointData): boolean {
  const filePath = join(CHECKPOINT_DIR, `${safeFileName(data.sessionId)}.json`)
  const tmpPath = filePath + '.tmp'
  try {
    writeFileSync(tmpPath, JSON.stringify(data), { mode: 0o600 })
    renameSync(tmpPath, filePath)
    return true
  } catch {
    // Best effort - don't crash the daemon over a checkpoint failure
    try { unlinkSync(tmpPath) } catch { /* ignore */ }
    return false
  }
}

/** Load all checkpoint files from disk. */
export function loadCheckpoints(): CheckpointData[] {
  if (!existsSync(CHECKPOINT_DIR)) return []

  const results: CheckpointData[] = []
  try {
    const files = readdirSync(CHECKPOINT_DIR)
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      try {
        const content = readFileSync(join(CHECKPOINT_DIR, file), 'utf8')
        const data = JSON.parse(content) as CheckpointData
        if (data.sessionId && data.cwd) {
          results.push(data)
        }
      } catch {
        // Skip corrupt checkpoint files
      }
    }
  } catch {
    // Directory read failed
  }
  return results
}

/** Delete a specific checkpoint file. */
export function deleteCheckpoint(sessionId: string): void {
  lastWritten.delete(sessionId)
  retained.delete(safeFileName(sessionId))
  try {
    unlinkSync(join(CHECKPOINT_DIR, `${safeFileName(sessionId)}.json`))
  } catch {
    // May not exist
  }
}

/**
 * Whether a session's checkpoint should be deleted the moment its PTY exits.
 * A shell that ended by itself (user typed `exit`) or was closed by a client
 * must not come back after a daemon restart. One killed by a signal (logout,
 * reboot) keeps its checkpoint so it can be restored. While the daemon itself
 * is shutting down every checkpoint is kept.
 */
export function shouldDropCheckpointOnExit(opts: { clean: boolean; shuttingDown: boolean }): boolean {
  return opts.clean && !opts.shuttingDown
}
