import { logger } from '../lib/logger'
import { enrichedEnv as baseEnrichedEnv } from '../lib/enrichedEnv'
import { app } from 'electron'
import { execFile, spawn, ChildProcess } from 'child_process'
import { promisify } from 'util'
import http from 'http'

const exec = promisify(execFile)

export interface SimulatorDevice {
  id: string
  name: string
  platform: 'ios' | 'android'
  type: 'simulator' | 'emulator' | 'real'
  version: string
  state: 'online' | 'offline'
  model: string
}

export interface ISimulatorService {
  /** Returns true if mobilecli is installed and resolvable. */
  checkCli(): Promise<boolean>
  /** List all available simulator/emulator devices. */
  listDevices(): Promise<SimulatorDevice[]>
  /** Boot a device and wait until it is online (up to 30s). */
  bootDevice(deviceId: string): Promise<void>
  /** Shutdown a device and wait until it is offline (up to 30s). */
  shutdownDevice(deviceId: string): Promise<void>
  /** Send a W3C pointer action sequence to the device. Returns an error string or null. */
  gesture(deviceId: string, actions: Record<string, unknown>[]): Promise<string | null>
  /** Press a hardware button (HOME, BACK, VOLUME_UP, etc.). Returns an error string or null. */
  pressButton(deviceId: string, button: string): Promise<string | null>
  /** Take a screenshot. Returns raw base64 PNG data or null. */
  screenshot(deviceId: string): Promise<string | null>
  /** Get the current device orientation. */
  getOrientation(deviceId: string): Promise<string>
  /** Set the device orientation. */
  setOrientation(deviceId: string, orientation: string): Promise<void>
  /** Type text on the device. Returns an error string or null. */
  sendText(deviceId: string, text: string): Promise<string | null>
  /** Get the physical screen size in points. */
  getScreenSize(deviceId: string): Promise<{ width: number; height: number }>
  /** Create an MJPEG screencapture session and return its stream URL + screen size. */
  createStreamSession(deviceId: string, displayHeight?: number): Promise<{ streamUrl: string; screenSize: { width: number; height: number } }>
  /** Hide the Simulator.app window via AppleScript. */
  hideSimulatorWindow(): Promise<void>
  /** Trigger a React Native Metro bundler reload. */
  metroReload(port?: number): Promise<void>
  /** Send an OS-level key combo to the device. */
  sendKeyCombo(deviceId: string, platform: string, combo: string): Promise<void>
  /** Send a signal to a running Flutter process (SIGUSR1 = hot reload, SIGUSR2 = hot restart). */
  flutterSignal(signal: string): Promise<void>
  /** Kill the mobilecli server process. */
  killAll(): void
}

const RPC_PORT = 12_000
const RPC_URL = `http://localhost:${RPC_PORT}/rpc`
const STREAM_BASE = `http://localhost:${RPC_PORT}`

class SimulatorService implements ISimulatorService {
  private cliPath: string | null = null
  private serverChild: ChildProcess | null = null
  private serverReady = false
  private rpcId = 0

  constructor() {
    app.on('before-quit', () => this.shutdown())
  }

  private enrichedEnv(): NodeJS.ProcessEnv {
    const base = baseEnrichedEnv()
    const androidHome = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? ''
    const androidPaths = androidHome
      ? [`${androidHome}/platform-tools`, `${androidHome}/emulator`, `${androidHome}/tools/bin`]
      : []
    // Prepend Android SDK paths to the login-shell-resolved PATH
    const envPath = [...androidPaths, base.PATH ?? ''].join(':')
    return { ...base, PATH: envPath }
  }

  private async resolveCli(): Promise<string | null> {
    if (this.cliPath !== null) return this.cliPath || null
    // Use the user's login shell so PATH managers (Homebrew, nvm, etc.) are
    // visible in production builds launched from Finder/Dock, where
    // process.env.PATH is minimal. No need to pass an enriched env — the login
    // shell sources the user's profile itself.
    const userShell = process.env.SHELL || '/bin/zsh'
    try {
      const { stdout } = await exec(userShell, ['-l', '-c', 'which mobilecli'])
      this.cliPath = stdout.trim()
      return this.cliPath
    } catch { /* not found */ }
    this.cliPath = ''
    return null
  }

  async checkCli(): Promise<boolean> {
    // Reset the cached path so we re-probe (e.g. after user installs mobilecli)
    this.cliPath = null
    return (await this.resolveCli()) !== null
  }

  /** Detect which platform toolchains are available. */
  async checkPlatformTools(): Promise<{ xcode: boolean; androidSdk: boolean }> {
    const userShell = process.env.SHELL || '/bin/zsh'
    const has = (bin: string) =>
      exec(userShell, ['-l', '-c', `which ${bin}`]).then(() => true).catch(() => false)
    const [xcode, androidSdk] = await Promise.all([
      has('xcrun'),     // Xcode CLT — ships simctl
      has('adb'),       // Android SDK — platform-tools
    ])
    return { xcode, androidSdk }
  }

  // ─── HTTP Server Lifecycle ───────────────────────────────────────────────

  private async ensureServer(): Promise<void> {
    if (this.serverReady) return

    if (await this.pingServer()) { this.serverReady = true; return }

    const cli = await this.resolveCli()
    if (!cli) throw new Error('mobilecli is not installed')

    this.serverChild = spawn(cli, ['server', 'start', '--listen', `localhost:${RPC_PORT}`, '--cors'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: this.enrichedEnv(),
      detached: true,
    })
    this.serverChild.unref()
    this.serverChild.on('exit', () => { this.serverChild = null; this.serverReady = false })
    this.serverChild.stdout?.on('data', (d: Buffer) => {
      const m = d.toString().trim()
      if (m) { /* server stdout — suppress */ }
    })
    this.serverChild.stderr?.on('data', (d: Buffer) => {
      const m = d.toString().trim()
      if (m) logger.error(`[mobilecli:server:err] ${m}`)
    })

    const deadline = Date.now() + 8_000
    while (Date.now() < deadline) {
      if (await this.pingServer()) { this.serverReady = true; return }
      await new Promise((r) => setTimeout(r, 300))
    }
    throw new Error('mobilecli server failed to start')
  }

  private pingServer(): Promise<boolean> {
    return new Promise((resolve) => {
      const body = JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'server.info', params: {} })
      const req = http.request(RPC_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, timeout: 2_000,
      }, (res) => { res.resume(); resolve(res.statusCode === 200) })
      req.on('error', () => resolve(false))
      req.on('timeout', () => { req.destroy(); resolve(false) })
      req.end(body)
    })
  }

  // ─── JSON-RPC ────────────────────────────────────────────────────────────

  private rpc<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({ jsonrpc: '2.0', id: ++this.rpcId, method, params })
      const req = http.request(RPC_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, timeout: 30_000,
      }, (res) => {
        let data = ''
        res.on('data', (chunk) => { data += chunk })
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data)
            if (parsed.error) reject(new Error(parsed.error.message || parsed.error.data || 'RPC error'))
            else resolve(parsed.result as T)
          } catch { reject(new Error('Invalid JSON-RPC response')) }
        })
      })
      req.on('error', (e) => reject(e))
      req.on('timeout', () => { req.destroy(); reject(new Error('RPC timeout')) })
      req.end(body)
    })
  }

  private async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    await this.ensureServer()
    return this.rpc<T>(method, params)
  }

  // ─── Device Operations ───────────────────────────────────────────────────

  async listDevices(): Promise<SimulatorDevice[]> {
    try {
      const data = await this.call<{ devices: SimulatorDevice[] }>('devices.list', { includeOffline: true })
      return data.devices ?? []
    } catch (err) {
      logger.error('[Simulator] listDevices failed:', err)
      return []
    }
  }

  async bootDevice(deviceId: string): Promise<void> {
    await this.call('device.boot', { deviceId })
    // Poll until the device reports as online (up to 30s).
    // Android emulators can take a while after the boot command returns.
    await this.waitForDeviceOnline(deviceId, 30_000)
  }

  private async waitForDeviceOnline(deviceId: string, timeoutMs: number): Promise<void> {
    const start = Date.now()
    const interval = 1500
    while (Date.now() - start < timeoutMs) {
      try {
        const data = await this.call<{ devices: SimulatorDevice[] }>('devices.list', { includeOffline: true })
        const dev = (data.devices ?? []).find((d) => d.id === deviceId)
        if (dev?.state === 'online') return
      } catch { /* retry */ }
      await new Promise((r) => setTimeout(r, interval))
    }
  }

  async shutdownDevice(deviceId: string): Promise<void> {
    await this.call('device.shutdown', { deviceId })
    await this.waitForDeviceOffline(deviceId, 30_000)
  }

  private async waitForDeviceOffline(deviceId: string, timeoutMs: number): Promise<void> {
    const start = Date.now()
    const interval = 1500
    while (Date.now() - start < timeoutMs) {
      try {
        const data = await this.call<{ devices: SimulatorDevice[] }>('devices.list', { includeOffline: true })
        const dev = (data.devices ?? []).find((d) => d.id === deviceId)
        if (!dev || dev.state !== 'online') return
      } catch { /* retry */ }
      await new Promise((r) => setTimeout(r, interval))
    }
  }

  /**
   * Send a W3C pointer action sequence to the device.
   * Actions format: [{ type: 'pointerMove', x, y, duration }, { type: 'pointerDown', button: 0 }, ...]
   */
  async gesture(deviceId: string, actions: Record<string, unknown>[]): Promise<string | null> {
    try {
      await this.call('device.io.gesture', { deviceId, actions })
      return null
    } catch (err) {
      logger.error(`[Simulator] gesture failed:`, (err as Error).message)
      return 'gesture_failed'
    }
  }

  /**
   * Press a hardware button. Supported: HOME, BACK, VOLUME_UP, VOLUME_DOWN, POWER, APP_SWITCH, ENTER.
   */
  async pressButton(deviceId: string, button: string): Promise<string | null> {
    try {
      await this.call('device.io.button', { deviceId, button })
      return null
    } catch (err) {
      logger.error(`[Simulator] pressButton(${button}) failed:`, (err as Error).message)
      return 'button_failed'
    }
  }

  /**
   * Take a screenshot, returns base64-encoded image data.
   */
  async screenshot(deviceId: string): Promise<string | null> {
    try {
      const data = await this.call<{ data: string }>('device.screenshot', { deviceId, format: 'png' })
      let raw = data.data ?? null
      if (!raw) return null
      // mobilecli returns a data URI — strip the prefix for raw base64
      const commaIdx = raw.indexOf(',')
      if (commaIdx !== -1) raw = raw.slice(commaIdx + 1)
      return raw
    } catch (err) {
      logger.error(`[Simulator] screenshot failed:`, (err as Error).message)
      return null
    }
  }

  /**
   * Get/set device orientation. Value: 'portrait' | 'landscape'.
   */
  async getOrientation(deviceId: string): Promise<string> {
    try {
      const data = await this.call<{ orientation: string }>('device.io.orientation.get', { deviceId })
      return data.orientation ?? 'portrait'
    } catch { return 'portrait' }
  }

  async setOrientation(deviceId: string, orientation: string): Promise<void> {
    await this.call('device.io.orientation.set', { deviceId, orientation })
  }

  /**
   * Type text on the device. Uses `device.io.text` RPC.
   */
  async sendText(deviceId: string, text: string): Promise<string | null> {
    try {
      await this.call('device.io.text', { deviceId, text })
      return null
    } catch (err) {
      logger.error(`[Simulator] sendText failed:`, (err as Error).message)
      return 'text_failed'
    }
  }

  async getScreenSize(deviceId: string): Promise<{ width: number; height: number }> {
    try {
      const data = await this.call<{ device: { screenSize?: { width: number; height: number }; platform?: string } }>(
        'device.info', { deviceId },
      )
      const ss = data.device?.screenSize
      if (ss?.width && ss?.height) return { width: ss.width, height: ss.height }
      // Use platform-appropriate fallback if screen size is missing
      if (data.device?.platform === 'android') return { width: 1080, height: 2400 }
    } catch (err) {
      logger.warn(`[Simulator] getScreenSize failed for ${deviceId}:`, err)
    }
    // Default to iPhone 14/15 dimensions
    return { width: 390, height: 844 }
  }

  // ─── Streaming (session URL for renderer to fetch directly) ──────────────

  /**
   * Creates a screencapture session and returns the full stream URL.
   * The renderer fetches the MJPEG stream directly — no main-process relay.
   */
  async createStreamSession(
    deviceId: string, displayHeight?: number,
  ): Promise<{ streamUrl: string; screenSize: { width: number; height: number } }> {
    await this.ensureServer()

    // Fetch screen size first — also needed by the caller for layout
    const screenSize = await this.getScreenSize(deviceId)

    // Compute optimal scale: match stream resolution to actual display size
    let scale = 0.5 // safe default
    if (displayHeight && displayHeight > 0) {
      const dpr = Math.min(globalThis.devicePixelRatio ?? 2, 2) // cap at 2× for perf
      const targetH = displayHeight * dpr
      scale = Math.min(1, Math.max(0.2, targetH / screenSize.height))
      // Round to nearest 0.05 to avoid weird server-side rounding
      scale = Math.round(scale * 20) / 20
    }

    logger.debug(`[Simulator] createStreamSession: deviceId=${deviceId} scale=${scale} screenSize=${screenSize.width}x${screenSize.height}`)
    const session = await this.rpc<{ sessionUrl: string }>(
      'device.screencapture', { deviceId, format: 'mjpeg', scale },
    )
    const streamUrl = `${STREAM_BASE}${session.sessionUrl}`
    logger.debug(`[Simulator] Stream URL: ${streamUrl}`)
    return { streamUrl, screenSize }
  }

  // ─── Framework Debug Controls ──────────────────────────────────────────────

  /**
   * Hide the Simulator.app window via AppleScript so it doesn't appear
   * alongside Braid while we're streaming the device screen.
   */
  async hideSimulatorWindow(): Promise<void> {
    await exec('osascript', [
      '-e', 'tell application "System Events" to set visible of process "Simulator" to false',
    ], { env: this.enrichedEnv() })
  }

  /**
   * Trigger a React Native reload via Metro bundler's HTTP API.
   * No Simulator window activation needed — purely server-side.
   */
  async metroReload(port = 8081): Promise<void> {
    await fetch(`http://localhost:${port}/reload`, { method: 'POST' })
  }

  /**
   * Send an OS-level key combo to the simulator/emulator.
   * iOS: Briefly activates Simulator to receive the keystroke, then immediately
   *       hides it again so its window doesn't linger alongside Braid.
   * Android: `adb -s <id> shell input keyevent <code>` (e.g. "82" for KEYCODE_MENU)
   */
  async sendKeyCombo(deviceId: string, platform: string, combo: string): Promise<void> {
    if (platform === 'ios') {
      const parts = combo.toLowerCase().split('+')
      const key = parts[parts.length - 1]
      const modifiers = parts.slice(0, -1)

      // Validate key — must be a single printable character or known named key.
      // This prevents AppleScript injection via crafted combo strings.
      const ALLOWED_KEYS = new Set(['r', 'd', 'z', 'i', 'h', 'k', 's', 'l', 'return', 'tab', 'escape', 'delete', 'space'])
      if (key.length !== 1 && !ALLOWED_KEYS.has(key)) {
        throw new Error(`Invalid key for sendKeyCombo: ${key}`)
      }
      // Sanitize: strip anything that could escape an AppleScript string literal
      const safeKey = key.replace(/["\\\r\n]/g, '')
      if (!safeKey) throw new Error('Empty key after sanitization')

      const VALID_MODIFIERS = new Set(['cmd', 'shift', 'ctrl', 'control', 'alt', 'option'])
      const modMap: Record<string, string> = { cmd: 'command down', shift: 'shift down', ctrl: 'control down', control: 'control down', alt: 'option down', option: 'option down' }
      const validMods = modifiers.filter((m) => VALID_MODIFIERS.has(m))
      const modStr = validMods.map((m) => modMap[m]).join(', ')
      const usingClause = modStr ? ` using {${modStr}}` : ''
      await exec('osascript', [
        '-e', 'set prevApp to (path to frontmost application as text)',
        '-e', 'tell application "Simulator" to activate',
        '-e', 'delay 0.15',
        '-e', `tell application "System Events" to keystroke "${safeKey}"${usingClause}`,
        '-e', 'delay 0.1',
        '-e', 'tell application "System Events" to set visible of process "Simulator" to false',
        '-e', 'activate application prevApp',
      ], { env: this.enrichedEnv() })
    } else {
      // Validate Android keyevent code — must be numeric
      if (!/^\d+$/.test(combo)) throw new Error(`Invalid Android keyevent code: ${combo}`)
      await exec('adb', ['-s', deviceId, 'shell', 'input', 'keyevent', combo], { env: this.enrichedEnv() })
    }
  }

  /**
   * Send a signal to a running Flutter process.
   * SIGUSR1 = hot reload, SIGUSR2 = hot restart.
   */
  async flutterSignal(signal: string): Promise<void> {
    const { stdout } = await exec('pgrep', ['-f', 'flutter_tools.*run'], { env: this.enrichedEnv() })
    const pid = stdout.trim().split('\n')[0]
    if (!pid) throw new Error('No running Flutter process found')
    await exec('kill', [`-${signal}`, pid], { env: this.enrichedEnv() })
  }

  // ─── Cleanup ─────────────────────────────────────────────────────────────

  private shutdown(): void {
    if (this.serverChild) {
      try { this.serverChild.kill('SIGTERM') } catch { /* already dead */ }
      this.serverChild = null
      this.serverReady = false
    }
  }

  killAll(): void {
    this.shutdown()
  }
}

export const simulatorService = new SimulatorService()
