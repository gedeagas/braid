import { logger } from '../lib/logger'
import { app, desktopCapturer, shell, systemPreferences } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'

const exec = promisify(execFile)

export interface CaptureSource {
  id: string
  name: string
  appName: string
  thumbnailDataUrl: string
}

const EMULATOR_TITLE_PATTERNS: { pattern: RegExp; appName: string }[] = [
  // iOS Simulator — window titles are device names like "iPhone 16 Pro", "iPad Air"
  { pattern: /^iPhone\b/i, appName: 'Simulator' },
  { pattern: /^iPad\b/i, appName: 'Simulator' },
  { pattern: /^Apple Watch\b/i, appName: 'Simulator' },
  { pattern: /^Apple TV\b/i, appName: 'Simulator' },
  { pattern: /\bSimulator\b/i, appName: 'Simulator' },
  // Android Emulator
  { pattern: /Android Emulator/i, appName: 'Android Emulator' },
  { pattern: /^emulator-\d+/i, appName: 'Android Emulator' },
  // Android Studio device manager preview — "Pixel 7 API 34"
  { pattern: /^Pixel\b.*API/i, appName: 'Android Emulator' },
]

class WindowCaptureService {
  /** Source ID the renderer wants to capture next (set before getDisplayMedia). */
  pendingSourceId: string | null = null

  /** Set which source the renderer is about to capture. */
  selectSource(sourceId: string): void {
    this.pendingSourceId = sourceId
  }

  /** List open windows that match known emulator/simulator title patterns. */
  async getSources(): Promise<CaptureSource[]> {
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 320, height: 240 },
    })

    if (!app.isPackaged) {
      logger.debug('[WindowCapture] All windows:', sources.map((s) => `${s.id} "${s.name}"`))
    }

    const results: CaptureSource[] = []
    for (const source of sources) {
      const match = EMULATOR_TITLE_PATTERNS.find((p) => p.pattern.test(source.name))
      if (match) {
        results.push({
          id: source.id,
          name: source.name,
          appName: match.appName,
          thumbnailDataUrl: source.thumbnail.toDataURL(),
        })
      }
    }
    return results
  }

  /** List ALL window source names (debug helper — check main process console). */
  async listAllWindows(): Promise<Array<{ id: string; name: string }>> {
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 1, height: 1 },
    })
    return sources.map((s) => ({ id: s.id, name: s.name }))
  }

  /**
   * Send a mouse click to a window at relative coordinates (0–1 range).
   * Uses JXA (JavaScript for Automation) + CoreGraphics CGEvent to click
   * at the correct absolute screen position.
   * Source ID format: "window:<CGWindowID>:0".
   *
   * Returns 'ok' on success, 'no-accessibility' if permission missing.
   */
  async tapWindow(sourceId: string, relX: number, relY: number): Promise<string> {
    if (process.platform !== 'darwin') return 'ok'

    // CGEventPost requires Accessibility permission. Check first, and if not
    // granted, show the system prompt (passing true triggers the macOS dialog)
    // and open the deep link to the Accessibility pane.
    if (!systemPreferences.isTrustedAccessibilityClient(false)) {
      // Trigger the macOS system prompt
      systemPreferences.isTrustedAccessibilityClient(true)
      // Also open the Accessibility pane directly
      shell.openExternal(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
      )
      return 'no-accessibility'
    }

    // Validate all values interpolated into the JXA script to prevent injection.
    const winNum = parseInt(sourceId.split(':')[1] ?? '', 10)
    if (!Number.isFinite(winNum) || winNum <= 0) return 'ok'
    const rx = Number(relX)
    const ry = Number(relY)
    if (!Number.isFinite(rx) || !Number.isFinite(ry)) return 'ok'
    // Clamp to 0-1 relative coordinate range
    const safeRx = Math.max(0, Math.min(1, rx))
    const safeRy = Math.max(0, Math.min(1, ry))

    // JXA script — ObjC.deepUnwrap() converts CFArray/CFDict to native JS objects,
    // avoiding the AppleScript bridging issues with CoreFoundation types.
    const script = `
ObjC.import('CoreGraphics');

var list = ObjC.deepUnwrap(
  $.CGWindowListCopyWindowInfo($.kCGWindowListOptionIncludingWindow, ${winNum})
);
if (!list || !list.length) { ''; }
else {
  var b = list[0].kCGWindowBounds;
  var ax = b.X + ${safeRx} * b.Width;
  var ay = b.Y + ${safeRy} * b.Height;
  var pt = $.CGPointMake(ax, ay);
  var down = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseDown, pt, 0);
  var up   = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseUp,   pt, 0);
  $.CGEventPost($.kCGHIDEventTap, down);
  delay(0.05);
  $.CGEventPost($.kCGHIDEventTap, up);
  'ok';
}
`
    try {
      await exec('osascript', ['-l', 'JavaScript', '-e', script])
      return 'ok'
    } catch (err) {
      logger.error('[WindowCapture] tapWindow failed:', err)
      return 'error'
    }
  }

  /** Check macOS Screen Recording permission status. */
  checkPermission(): string {
    if (process.platform !== 'darwin') return 'granted'
    return systemPreferences.getMediaAccessStatus('screen')
  }

  /** Open macOS Screen Recording preferences pane. */
  openPermissionSettings(): void {
    shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
    )
  }
}

export const windowCaptureService = new WindowCaptureService()
