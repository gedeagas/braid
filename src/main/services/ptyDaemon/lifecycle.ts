/**
 * Daemon lifecycle helpers - PID file, stale socket detection, running checks.
 */
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { PID_FILE_PATH, SOCKET_PATH } from './protocol'

/** Write the current process PID to the PID file. */
export function writePidFile(): void {
  mkdirSync(dirname(PID_FILE_PATH), { recursive: true })
  writeFileSync(PID_FILE_PATH, String(process.pid), { mode: 0o600 })
}

/** Remove the PID file. */
export function removePidFile(): void {
  try {
    unlinkSync(PID_FILE_PATH)
  } catch {
    // May not exist
  }
}

/** Remove the socket file. */
export function removeSocketFile(): void {
  try {
    unlinkSync(SOCKET_PATH)
  } catch {
    // May not exist
  }
}

/** Read the PID from the PID file. Returns null if not found. */
export function readPidFile(): number | null {
  try {
    const content = readFileSync(PID_FILE_PATH, 'utf8').trim()
    const pid = parseInt(content, 10)
    return isNaN(pid) ? null : pid
  } catch {
    return null
  }
}

/** Check if a process with the given PID is running. */
export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Check if the daemon is currently running.
 * Returns the PID if running, null otherwise.
 * Cleans up stale PID file and socket if the process is dead.
 */
export function isDaemonRunning(): number | null {
  const pid = readPidFile()
  if (pid === null) return null

  if (isProcessRunning(pid)) {
    return pid
  }

  // Process is dead - clean up stale files
  removePidFile()
  if (existsSync(SOCKET_PATH)) {
    removeSocketFile()
  }
  return null
}

/**
 * Send SIGTERM to the daemon process if it's running.
 * Returns true if a signal was sent.
 */
export function stopDaemon(): boolean {
  const pid = isDaemonRunning()
  if (pid === null) return false

  try {
    process.kill(pid, 'SIGTERM')
    return true
  } catch {
    return false
  }
}
