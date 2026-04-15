/**
 * Device operation helpers for the mobile MCP server.
 *
 * Thin wrappers over the mobilecli JSON-RPC server (port 12000) and CLI.
 * Also provides screenshot resizing (macOS sips) and accessibility tree access.
 *
 * ⚠️  This file runs inside a UtilityProcess (via agentWorker).
 * DO NOT import from 'electron' or any module that transitively imports it.
 */

import http from 'http'
import { execFile } from 'child_process'
import { writeFile, readFile, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { enrichedEnv } from '../lib/enrichedEnv'

// ─── JSON-RPC client ──────────────────────────────────────────────────────

const RPC_PORT = 12_000
const RPC_URL = `http://localhost:${RPC_PORT}/rpc`
let rpcId = 0

export function rpc<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params })
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

// ─── Device context ───────────────────────────────────────────────────────

let activeDeviceId: string | null = null

export function setActiveDevice(deviceId: string | null): void {
  activeDeviceId = deviceId
}

export function getActiveDevice(): string | null {
  return activeDeviceId
}

export function requireDevice(): string {
  if (!activeDeviceId) throw new Error('No device connected. Call mobile_use_device first.')
  return activeDeviceId
}

// ─── Device operations ────────────────────────────────────────────────────

export async function listDevices(): Promise<unknown[]> {
  const data = await rpc<{ devices: unknown[] }>('devices.list', { includeOffline: true })
  return data.devices ?? []
}

export async function bootDevice(deviceId: string): Promise<void> {
  await rpc('device.boot', { deviceId })
}

export async function gesture(deviceId: string, actions: Record<string, unknown>[]): Promise<string | null> {
  try {
    await rpc('device.io.gesture', { deviceId, actions })
    return null
  } catch (err) {
    return (err as Error).message || 'gesture_failed'
  }
}

export async function pressButton(deviceId: string, button: string): Promise<string | null> {
  try {
    await rpc('device.io.button', { deviceId, button })
    return null
  } catch (err) {
    return (err as Error).message || 'button_failed'
  }
}

export async function screenshot(deviceId: string): Promise<string | null> {
  try {
    const data = await rpc<{ data: string }>('device.screenshot', { deviceId, format: 'png' })
    let raw = data.data ?? null
    if (!raw) return null
    const commaIdx = raw.indexOf(',')
    if (commaIdx !== -1) raw = raw.slice(commaIdx + 1)
    return raw
  } catch { return null }
}

export async function getScreenSize(deviceId: string): Promise<{ width: number; height: number }> {
  try {
    const data = await rpc<{ device: { screenSize?: { width: number; height: number } } }>(
      'device.info', { deviceId },
    )
    const ss = data.device?.screenSize
    if (ss?.width && ss?.height) return { width: ss.width, height: ss.height }
  } catch { /* fall through */ }
  return { width: 390, height: 844 }
}

export async function sendText(deviceId: string, text: string): Promise<string | null> {
  try {
    await rpc('device.io.text', { deviceId, text })
    return null
  } catch (err) {
    return (err as Error).message || 'text_failed'
  }
}

export async function getOrientation(deviceId: string): Promise<string> {
  try {
    const data = await rpc<{ orientation: string }>('device.io.orientation.get', { deviceId })
    return data.orientation ?? 'portrait'
  } catch { return 'portrait' }
}

export async function setOrientation(deviceId: string, orientation: string): Promise<void> {
  await rpc('device.io.orientation.set', { deviceId, orientation })
}

// ─── Screenshot resize (macOS sips) ───────────────────────────────────────

/**
 * Resize a PNG screenshot to `targetWidth` and convert to JPEG.
 * Uses macOS built-in `sips` — no native dependencies needed.
 * Makes image pixel coordinates match logical point coordinate space.
 */
export async function resizeScreenshot(b64: string, targetWidth: number): Promise<string> {
  const id = Date.now()
  const tmpIn = join(tmpdir(), `braid-ss-${id}.png`)
  const tmpOut = join(tmpdir(), `braid-ss-${id}.jpg`)
  try {
    await writeFile(tmpIn, Buffer.from(b64, 'base64'))
    await new Promise<void>((resolve, reject) => {
      execFile('sips', [
        '--resampleWidth', String(targetWidth),
        tmpIn,
        '-s', 'format', 'jpeg',
        '-s', 'formatOptions', '75',
        '--out', tmpOut,
      ], (err) => (err ? reject(err) : resolve()))
    })
    const buf = await readFile(tmpOut)
    return buf.toString('base64')
  } finally {
    await unlink(tmpIn).catch(() => {})
    await unlink(tmpOut).catch(() => {})
  }
}

// ─── Accessibility tree ───────────────────────────────────────────────────

export interface UIElement {
  type: string
  text?: string
  label?: string
  name?: string
  value?: string
  identifier?: string
  rect: { x: number; y: number; width: number; height: number }
  focused?: boolean
}

/** Enriched environment using the user's login shell PATH (evaluated lazily at use-time). */
const getCliEnv = () => enrichedEnv()

/**
 * Get UI elements from the device accessibility tree.
 * Tries JSON-RPC `device.source` first (fast), falls back to
 * `mobilecli dump ui` CLI (spawns a process, always works).
 */
export async function getElements(deviceId: string): Promise<UIElement[]> {
  // Try JSON-RPC first — some mobilecli server versions expose this
  try {
    const data = await rpc<{ data?: { elements?: UIElement[] }; elements?: UIElement[] }>(
      'device.source', { deviceId },
    )
    const elems = data.data?.elements ?? data.elements
    if (elems && elems.length > 0) return elems
  } catch { /* fall through to CLI */ }

  // Fall back to CLI: `mobilecli --device <id> dump ui`
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile('mobilecli', ['--device', deviceId, 'dump', 'ui'], {
      encoding: 'utf-8', timeout: 15_000, env: getCliEnv(),
    }, (err, out) => (err ? reject(err) : resolve(out)))
  })
  const parsed = JSON.parse(stdout)
  return parsed.data?.elements ?? parsed.elements ?? []
}

// ─── Framework context ───────────────────────────────────────────────────

let activeFramework: 'react-native' | 'flutter' | null = null

export function setActiveFramework(fw: typeof activeFramework): void {
  activeFramework = fw
}

export function getActiveFramework(): typeof activeFramework {
  return activeFramework
}

// ─── Framework debug actions ─────────────────────────────────────────────

/**
 * Send a keystroke to the iOS Simulator via AppleScript.
 * Briefly activates Simulator to receive the keystroke, then hides
 * its window and restores the previous frontmost app.
 */
async function iosKeystroke(key: string, modifiers: string[] = []): Promise<void> {
  const modMap: Record<string, string> = { cmd: 'command down', shift: 'shift down', ctrl: 'control down', alt: 'option down' }
  const modStr = modifiers.map((m) => modMap[m] ?? `${m} down`).join(', ')
  const usingClause = modStr ? ` using {${modStr}}` : ''
  await new Promise<void>((resolve, reject) => {
    execFile('osascript', [
      '-e', 'set prevApp to (path to frontmost application as text)',
      '-e', 'tell application "Simulator" to activate',
      '-e', 'delay 0.15',
      '-e', `tell application "System Events" to keystroke "${key}"${usingClause}`,
      '-e', 'delay 0.1',
      '-e', 'tell application "System Events" to set visible of process "Simulator" to false',
      '-e', 'activate application prevApp',
    ], { env: getCliEnv() }, (err) => err ? reject(err) : resolve())
  })
}

/** Trigger a React Native reload via Metro bundler HTTP API. */
async function rnReload(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const req = http.request('http://localhost:8081/reload', { method: 'POST' }, () => resolve())
    req.on('error', reject)
    req.end()
  })
}

/** Open the React Native developer menu. */
async function rnDevMenu(deviceId: string, platform: string): Promise<void> {
  if (platform === 'ios') {
    await iosKeystroke('d', ['cmd'])
  } else {
    // Android: KEYCODE_MENU (82) opens RN dev menu
    await new Promise<void>((resolve, reject) => {
      execFile('adb', ['-s', deviceId, 'shell', 'input', 'keyevent', '82'], { env: getCliEnv() }, (err) =>
        err ? reject(err) : resolve())
    })
  }
}

/** Send a signal to the running Flutter process. */
async function flutterSignal(sig: string): Promise<void> {
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile('pgrep', ['-f', 'flutter_tools.*run'], { env: getCliEnv() }, (err, out) =>
      err ? reject(new Error('No running Flutter process found')) : resolve(out))
  })
  const pid = stdout.trim().split('\n')[0]
  if (!pid) throw new Error('No running Flutter process found')
  await new Promise<void>((resolve, reject) => {
    execFile('kill', [`-${sig}`, pid], { env: getCliEnv() }, (err) =>
      err ? reject(err) : resolve())
  })
}

/**
 * Reload the running app. Framework-aware:
 * - React Native: triggers fast refresh via Metro HTTP API
 * - Flutter: triggers hot reload via SIGUSR1
 */
export async function reloadApp(): Promise<string> {
  if (activeFramework === 'react-native') {
    await rnReload()
    return 'React Native fast refresh triggered'
  }
  if (activeFramework === 'flutter') {
    await flutterSignal('SIGUSR1')
    return 'Flutter hot reload triggered'
  }
  throw new Error('No mobile framework detected — cannot reload')
}

/** Open the React Native developer menu. Only works for RN projects. */
export async function openDevMenu(deviceId: string, platform: string): Promise<string> {
  if (activeFramework !== 'react-native') {
    throw new Error('Dev menu is only available for React Native projects')
  }
  await rnDevMenu(deviceId, platform)
  return 'React Native developer menu opened'
}

/** Flutter hot restart (full restart, resets state). */
export async function hotRestart(): Promise<string> {
  if (activeFramework !== 'flutter') {
    throw new Error('Hot restart is only available for Flutter projects')
  }
  await flutterSignal('SIGUSR2')
  return 'Flutter hot restart triggered'
}

/** Compact element representation for Claude — includes center point for easy tapping. */
export function formatElements(elements: UIElement[]): string {
  const items = elements
    .filter((el) => el.rect.width > 0 && el.rect.height > 0)
    .map((el) => {
      const cx = Math.round(el.rect.x + el.rect.width / 2)
      const cy = Math.round(el.rect.y + el.rect.height / 2)
      const parts: string[] = [`[${el.type}]`]
      if (el.text) parts.push(`text="${el.text}"`)
      if (el.label && el.label !== el.text) parts.push(`label="${el.label}"`)
      if (el.value) parts.push(`value="${el.value}"`)
      if (el.identifier) parts.push(`id="${el.identifier}"`)
      parts.push(`center=(${cx},${cy})`)
      parts.push(`rect=(${el.rect.x},${el.rect.y},${el.rect.width}×${el.rect.height})`)
      if (el.focused) parts.push('FOCUSED')
      return parts.join(' ')
    })
  return items.join('\n')
}
