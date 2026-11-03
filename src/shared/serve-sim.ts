/** Webview partition for the embedded serve-sim iOS Simulator preview. */
export const SERVE_SIM_PARTITION = 'persist:serve-sim'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost'])

/** True for the loopback http origin a local serve-sim preview server listens on. */
export function isServeSimUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname) && parsed.port !== ''
  } catch {
    return false
  }
}

/**
 * Pull the preview URL out of serve-sim's startup banner ("  - Local:   http://localhost:3200").
 * Normalised to 127.0.0.1 since the server binds IPv4 loopback only.
 */
export function parseServeSimLocalUrl(output: string): string | null {
  const match = /Local:\s+http:\/\/(?:localhost|127\.0\.0\.1):(\d+)/.exec(output)
  return match ? `http://127.0.0.1:${match[1]}` : null
}
