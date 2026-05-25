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

/** Start periodic checkpointing. */
export function startCheckpointing(host: SessionHost): void {
  if (intervalHandle) return

  mkdirSync(CHECKPOINT_DIR, { recursive: true, mode: 0o700 })

  intervalHandle = setInterval(() => {
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

/** Write all session checkpoints to disk atomically. */
export function flushCheckpoints(host: SessionHost): void {
  const checkpoints = host.getCheckpoints()
  const activeIds = new Set(checkpoints.map((cp) => cp.sessionId))

  mkdirSync(CHECKPOINT_DIR, { recursive: true, mode: 0o700 })

  // Write active session checkpoints
  for (const cp of checkpoints) {
    writeCheckpoint(cp)
  }

  // Remove checkpoints for sessions that no longer exist
  try {
    const files = readdirSync(CHECKPOINT_DIR)
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      const sessionId = file.replace(/\.json$/, '')
      if (!activeIds.has(sessionId)) {
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

/** Write a single checkpoint atomically. */
function writeCheckpoint(data: CheckpointData): void {
  const filePath = join(CHECKPOINT_DIR, `${safeFileName(data.sessionId)}.json`)
  const tmpPath = filePath + '.tmp'
  try {
    writeFileSync(tmpPath, JSON.stringify(data), { mode: 0o600 })
    renameSync(tmpPath, filePath)
  } catch {
    // Best effort - don't crash the daemon over a checkpoint failure
    try { unlinkSync(tmpPath) } catch { /* ignore */ }
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
  try {
    unlinkSync(join(CHECKPOINT_DIR, `${safeFileName(sessionId)}.json`))
  } catch {
    // May not exist
  }
}
