// After an app update, the daemon spawned by the previous build may still be
// running with the old code. It is replaced by this build's daemon only when
// that can't hurt: it holds no sessions. Otherwise it keeps serving them so
// nothing is killed or duplicated, and is replaced on a later launch.

import { DaemonClient } from './client'
import { isDaemonRunning, shouldReplaceDaemon } from './lifecycle'

const EXIT_WAIT_MS = 5_000

/** Returns true when an outdated daemon was shut down. Never throws. */
export async function replaceOutdatedDaemon(expectedVersion: string): Promise<boolean> {
  const probe = new DaemonClient()
  try {
    await probe.connect()
    const hello = await probe.hello()
    const sessionCount = hello.sessionCount ?? (await probe.list()).length
    if (!shouldReplaceDaemon({ running: hello.version, expected: expectedVersion, sessionCount })) return false
    await probe.shutdown().catch(() => { /* it may close the socket before replying */ })
  } catch {
    return false
  } finally {
    probe.disconnect()
  }
  const start = Date.now()
  while (Date.now() - start < EXIT_WAIT_MS) {
    if (!isDaemonRunning()) return true
    await new Promise((r) => setTimeout(r, 100))
  }
  return false
}
