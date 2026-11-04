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

/** Per-device screen config served by the preview's same-origin helper proxy. */
export function serveSimConfigUrl(baseUrl: string, deviceId: string): string {
  return `${baseUrl}/helper/${encodeURIComponent(deviceId)}/config`
}

/**
 * serve-sim reports a 0x0 screen until native capture has delivered a frame,
 * so a non-zero size is the signal that video and input are actually live.
 */
export function isServeSimCaptureReady(config: unknown): boolean {
  if (!config || typeof config !== 'object') return false
  const { width, height } = config as { width?: unknown; height?: unknown }
  return typeof width === 'number' && typeof height === 'number' && width > 0 && height > 0
}
