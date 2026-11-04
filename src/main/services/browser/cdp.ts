// One Chrome DevTools Protocol attachment per browser guest, shared by
// viewport emulation and agent automation. Also buffers console + network
// activity so agents can read recent logs.
import type { WebContents } from 'electron'

const MAX_LOG_ENTRIES = 300

export interface ConsoleEntry { level: string; text: string; url: string; line: number; time: number }
export interface NetworkEntry { method: string; url: string; status: number | null; type: string; failed?: string; time: number }

interface GuestCdp {
  console: ConsoleEntry[]
  network: NetworkEntry[]
  requests: Map<string, NetworkEntry>
}

const state = new WeakMap<WebContents, GuestCdp>()

function push<T>(list: T[], entry: T): void {
  list.push(entry)
  if (list.length > MAX_LOG_ENTRIES) list.splice(0, list.length - MAX_LOG_ENTRIES)
}

/** Attach the debugger (idempotent) and start buffering logs. */
export async function ensureCdp(wc: WebContents): Promise<GuestCdp> {
  let s = state.get(wc)
  if (s && wc.debugger.isAttached()) return s
  if (!wc.debugger.isAttached()) wc.debugger.attach('1.3')
  if (!s) {
    s = { console: [], network: [], requests: new Map() }
    state.set(wc, s)
    const entry = s
    wc.on('console-message', (details) => {
      const d = details as unknown as { level: string | number; message: string; sourceId: string; lineNumber: number }
      const level = typeof d.level === 'number' ? ['verbose', 'info', 'warning', 'error'][d.level] ?? 'info' : d.level
      push(entry.console, { level, text: d.message, url: d.sourceId, line: d.lineNumber, time: Date.now() })
    })
    wc.debugger.on('message', (_e, method, params: Record<string, unknown>) => {
      if (method === 'Network.requestWillBeSent') {
        const req = params.request as { method: string; url: string }
        const n: NetworkEntry = { method: req.method, url: req.url, status: null, type: String(params.type ?? ''), time: Date.now() }
        entry.requests.set(String(params.requestId), n)
        push(entry.network, n)
        if (entry.requests.size > MAX_LOG_ENTRIES) entry.requests.delete(entry.requests.keys().next().value as string)
      } else if (method === 'Network.responseReceived') {
        const n = entry.requests.get(String(params.requestId))
        if (n) n.status = (params.response as { status: number }).status
      } else if (method === 'Network.loadingFailed') {
        const n = entry.requests.get(String(params.requestId))
        if (n) n.failed = String(params.errorText ?? 'failed')
      }
    })
    wc.debugger.on('detach', () => { /* re-attached lazily on next ensureCdp */ })
  }
  await wc.debugger.sendCommand('Network.enable').catch(() => {})
  return s
}

export async function cdpSend<T = unknown>(wc: WebContents, method: string, params?: Record<string, unknown>): Promise<T> {
  await ensureCdp(wc)
  return wc.debugger.sendCommand(method, params) as Promise<T>
}

/**
 * PNG (base64) of the guest viewport or a clip of it, via CDP (consistent for
 * <webview> guests, supports clips and full-page capture).
 */
export async function captureGuestPng(
  wc: WebContents,
  clip?: { x: number; y: number; width: number; height: number },
  fullPage = false,
): Promise<string> {
  // Guests are transparent where a page sets no background (Braid paints white behind
  // them); give captures the white canvas a normal browser would.
  await cdpSend(wc, 'Emulation.setDefaultBackgroundColorOverride', { color: { r: 255, g: 255, b: 255, a: 1 } }).catch(() => {})
  const params: Record<string, unknown> = { format: 'png', captureBeyondViewport: fullPage }
  if (clip) params.clip = { ...clip, scale: 1 }
  const shot = await cdpSend<{ data: string }>(wc, 'Page.captureScreenshot', params)
  return shot.data
}

export function consoleLog(wc: WebContents): ConsoleEntry[] {
  return state.get(wc)?.console ?? []
}

export function networkLog(wc: WebContents): NetworkEntry[] {
  return state.get(wc)?.network ?? []
}
