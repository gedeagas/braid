// Starts (or reuses) the PTY daemon process and connects a client to it.

import { app } from 'electron'
import { join } from 'path'
import { fork } from 'child_process'
import type { DaemonClient } from './client'
import { isDaemonRunning, removeSocketFile, waitForDaemonListening, type RespawnThrottle } from './lifecycle'
import { DAEMON_VERSION_ENV } from './protocol'
import { replaceOutdatedDaemon } from './versionSkew'

async function spawnDaemon(throttle: RespawnThrottle, shell: string): Promise<void> {
  if (!throttle.tryAcquire()) {
    throw new Error('Terminal daemon keeps exiting on start; paused restarting it for a minute (see ~/Braid/daemon/daemon.log)')
  }
  // Find the daemon entry point - adjacent to this file in the build output
  const daemonPath = join(__dirname, 'daemonMain.js')

  const child = fork(daemonPath, [], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      // Pass through the shell so the daemon uses the same shell
      SHELL: shell,
      // Lets a later app build tell whether this daemon is outdated.
      [DAEMON_VERSION_ENV]: app.getVersion(),
    },
  })
  child.unref()

  // Wait until the daemon is accepting connections (it needs a moment to bind).
  await waitForDaemonListening(5_000)
}

/**
 * Connect `client` to the running daemon, spawning one when none runs. An
 * outdated daemon (from before an app update) is kept while it still has
 * sessions, so the user's shells and agents survive the update; it is only
 * swapped for this build's daemon once it is empty (see shouldReplaceDaemon).
 * Resolves after hello, so the daemon's features are known.
 */
export async function connectToDaemon(client: DaemonClient, throttle: RespawnThrottle, shell: string): Promise<void> {
  let pid = isDaemonRunning()
  if (pid && await replaceOutdatedDaemon(app.getVersion())) pid = isDaemonRunning()
  if (!pid) await spawnDaemon(throttle, shell)

  try {
    await client.connect()
  } catch {
    // Socket may be stale, try spawning a fresh daemon
    removeSocketFile()
    await spawnDaemon(throttle, shell)
    await client.connect()
  }
  // Learn what this daemon supports before any request depends on it.
  await client.hello()
}
