// Per-tab viewport emulation through CDP: the page sees the emulated size in
// window.innerWidth and media queries. `scale` shrinks it to fit the pane.
import type { WebContents } from 'electron'
import type { BrowserViewport } from '../../../shared/browser'
import { cdpSend } from './cdp'

const MIN = 200
const MAX = 4000

export function clampViewport(v: BrowserViewport): BrowserViewport {
  const clamp = (n: number) => Math.min(MAX, Math.max(MIN, Math.round(n)))
  return {
    width: clamp(v.width),
    height: clamp(v.height),
    deviceScaleFactor: Math.min(4, Math.max(1, Number(v.deviceScaleFactor) || 1)),
    mobile: Boolean(v.mobile),
  }
}

export async function setViewport(wc: WebContents, viewport: BrowserViewport | null, scale = 1): Promise<void> {
  if (!viewport) {
    await cdpSend(wc, 'Emulation.clearDeviceMetricsOverride').catch(() => {})
    await cdpSend(wc, 'Emulation.setTouchEmulationEnabled', { enabled: false }).catch(() => {})
    return
  }
  const v = clampViewport(viewport)
  await cdpSend(wc, 'Emulation.setDeviceMetricsOverride', {
    width: v.width,
    height: v.height,
    deviceScaleFactor: v.deviceScaleFactor,
    mobile: v.mobile,
    scale: Math.min(1, Math.max(0.1, scale)),
  })
  await cdpSend(wc, 'Emulation.setTouchEmulationEnabled', { enabled: v.mobile, maxTouchPoints: v.mobile ? 5 : 0 })
}
