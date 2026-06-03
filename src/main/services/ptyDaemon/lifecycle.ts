/**
 * Daemon lifecycle helpers - PID file, stale socket detection, running checks.
 */
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { connect } from 'net'
import { PID_FILE_PATH, SOCKET_PATH, SOCKET_IS_FILE } from './protocol'

/** Write the current process PID to the PID file. */
export function writePidFile(): void {
  mkdirSync(dirname(PID_FILE_PATH), { recursive: true, mode: 0o700 })
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

/** Remove the socket file. No-op on Windows, where the pipe has no disk path. */
export function removeSocketFile(): void {
  if (!SOCKET_IS_FILE) return
  try {
    unlinkSync(SOCKET_PATH)
  } catch {
    // May not exist
  }
}

/** Attempt a single connection to the IPC endpoint; resolves whether it succeeded. */
function probeConnect(timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = connect(SOCKET_PATH)
    let settled = false
    const timer = setTimeout(() => done(false), timeoutMs)
    const done = (ok: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      sock.destroy()
      resolve(ok)
    }
    sock.once('connect', () => done(true))
    sock.once('error', () => done(false))
  })
}

/**
 * Resolve once the daemon is accepting connections, or reject on timeout.
 *
 * POSIX: the Unix socket file appears atomically when the server binds, so a
 * cheap existsSync poll suffices. Windows: a named pipe is not a filesystem
 * entry, so existsSync never sees it - we probe by actually connecting.
 */
export async function waitForDaemonListening(timeoutMs: number): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (SOCKET_IS_FILE) {
      if (existsSync(SOCKET_PATH)) return
    } else if (await probeConnect(250)) {
      return
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('Timed out waiting for daemon socket')
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
