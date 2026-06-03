/**
 * PTY Daemon entry point - standalone Node.js process.
 *
 * This file is built as a separate Rollup entry and spawned by
 * the Electron main process via child_process.fork(). It runs
 * independently and survives Electron restarts.
 */
import { execSync } from 'child_process'
import { createWriteStream, mkdirSync } from 'fs'
import { join } from 'path'
import { SessionHost } from './sessionHost'
import { SocketServer } from './socketServer'
import { writePidFile, removePidFile } from './lifecycle'
import { startCheckpointing, stopCheckpointing, loadCheckpoints } from './checkpoint'
import { IDLE_SHUTDOWN_MS, SOCKET_PATH, DAEMON_DIR } from './protocol'
import { defaultShellPath } from '../../lib/shell'

let shuttingDown = false

// Redirect daemon logs to a file for troubleshooting
mkdirSync(DAEMON_DIR, { recursive: true, mode: 0o700 })
const logStream = createWriteStream(join(DAEMON_DIR, 'daemon.log'), { flags: 'a', mode: 0o600 })

function logSystemInfo(): void {
  // `ulimit` is a POSIX shell builtin; there is no Windows equivalent.
  const fdLimit = process.platform === 'win32'
    ? 'n/a'
    : (() => {
        try {
          return execSync('ulimit -n', { encoding: 'utf8' }).trim()
        } catch {
          return 'unknown'
        }
      })()
  log(`System info: fd-limit=${fdLimit}, pid=${process.pid}, shell=${process.env.SHELL ?? 'unset'}`)
}

async function main(): Promise<void> {
  logSystemInfo()
  const host = new SessionHost()

  let idleTimer: ReturnType<typeof setTimeout> | null = null

  function resetIdleTimer(): void {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      log('Idle timeout reached, shutting down')
      shutdown()
    }, IDLE_SHUTDOWN_MS)
  }

  async function shutdown(): Promise<void> {
    if (shuttingDown) return
    shuttingDown = true

    log('Shutting down...')
    stopCheckpointing()

    // Flush final checkpoints before killing PTYs
    const { flushCheckpoints } = await import('./checkpoint')
    flushCheckpoints(host)

    host.killAll()
    await server.close()
    removePidFile()
    log('Shutdown complete')
    process.exit(0)
  }

  const server = new SocketServer(host, shutdown)

  // Track client connections for idle auto-shutdown
  server.setClientCallbacks(
    () => {
      // Client connected - cancel idle timer
      if (idleTimer) {
        clearTimeout(idleTimer)
        idleTimer = null
      }
    },
    () => {
      // Client disconnected - restart idle timer if no clients left
      if (server.clientCount === 0) {
        resetIdleTimer()
      }
    },
  )

  // Write PID file
  writePidFile()

  // Restore sessions from checkpoints (cold restore)
  const shell = process.env.SHELL || defaultShellPath()
  const checkpoints = loadCheckpoints()
  for (const cp of checkpoints) {
    try {
      await host.restore(cp, shell)
      log(`Restored session: ${cp.sessionId}`)
    } catch (err) {
      log(`Failed to restore session ${cp.sessionId}: ${err}`)
    }
  }

  // Start socket server
  await server.start()
  log(`Listening on ${SOCKET_PATH} (pid: ${process.pid})`)

  // Start periodic checkpointing
  startCheckpointing(host)

  // Start idle timer (will be cancelled on first client connect)
  resetIdleTimer()

  // Signal handlers. SIGTERM/SIGINT are emulated on Windows; SIGHUP does not
  // exist there, so only register it on POSIX.
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
  if (process.platform !== 'win32') {
    process.on('SIGHUP', shutdown)
  }
}

function log(msg: string): void {
  const ts = new Date().toISOString()
  const line = `[pty-daemon ${ts}] ${msg}\n`
  logStream.write(line)
}

main().catch((err) => {
  const line = `[pty-daemon] Fatal: ${err}\n`
  logStream.write(line)
  process.exit(1)
})
