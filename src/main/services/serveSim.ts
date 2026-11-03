import { app, BrowserWindow, session, type Session } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import path from 'path'
import { logger } from '../lib/logger'
import { enrichedEnv } from '../lib/enrichedEnv'
import { SERVE_SIM_PARTITION, parseServeSimLocalUrl } from '../../shared/serve-sim'

/**
 * Runs serve-sim (https://github.com/EvanBacon/serve-sim) preview servers for
 * iOS Simulators. Each booted device gets its own loopback preview server whose
 * page the renderer embeds in a <webview>; serve-sim owns video, touch, keyboard
 * and hardware buttons through CoreSimulator directly.
 *
 * The CLI runs under Braid's bundled Node (ELECTRON_RUN_AS_NODE) in its own
 * process group, so a crash in its private-framework code can't take down main.
 */

const START_TIMEOUT_MS = 90_000 // covers a cold simulator boot
const STARTUP_LOG_LIMIT = 4_000

interface Instance {
  child: ChildProcess
  ready: Promise<string>
}

class ServeSimService {
  private instances = new Map<string, Instance>()

  constructor() {
    app.on('before-quit', () => this.stopAll())
  }

  /** serve-sim is macOS-only and must be resolvable from the app bundle. */
  isAvailable(): boolean {
    return process.platform === 'darwin' && this.resolveScript() !== null
  }

  /** Start (or reuse) the preview server for a device. Resolves with its loopback URL. */
  start(deviceId: string): Promise<string> {
    const existing = this.instances.get(deviceId)
    if (existing) return existing.ready

    const script = this.resolveScript()
    if (!script || process.platform !== 'darwin') {
      return Promise.reject(new Error('serve-sim is not available on this platform'))
    }

    const instance = this.spawnInstance(deviceId, script)
    this.instances.set(deviceId, instance)
    // A failed start must not linger, but never tear down a newer instance.
    instance.ready.catch(() => {
      if (this.instances.get(deviceId) === instance) this.stop(deviceId)
    })
    return instance.ready
  }

  stop(deviceId: string): void {
    const instance = this.instances.get(deviceId)
    if (!instance) return
    this.instances.delete(deviceId)
    killGroup(instance.child)
  }

  stopAll(): void {
    for (const id of [...this.instances.keys()]) this.stop(id)
  }

  private spawnInstance(deviceId: string, script: string): Instance {
    const child = spawn(process.execPath, [
      script, deviceId,
      '--host', '127.0.0.1',
      '--panes', 'none',
      '--fit',
      '--exit-on-simulator-shutdown',
    ], {
      // serve-sim respawns helpers via process.argv[0], which inherits this env.
      env: { ...enrichedEnv(), ELECTRON_RUN_AS_NODE: '1', NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    })

    const ready = new Promise<string>((resolve, reject) => {
      let output = ''
      let settled = false
      const settle = (fn: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        fn()
      }
      const timer = setTimeout(() => settle(() => reject(new Error('serve-sim did not start in time'))), START_TIMEOUT_MS)

      const onData = (chunk: Buffer) => {
        if (output.length < STARTUP_LOG_LIMIT) output += chunk.toString()
        const url = parseServeSimLocalUrl(output)
        if (url) settle(() => resolve(url))
      }
      child.stdout?.on('data', onData)
      child.stderr?.on('data', onData)

      child.on('error', (err) => settle(() => reject(err)))
      child.on('exit', (code, signal) => {
        const detail = output.trim().split('\n').slice(-3).join(' ')
        settle(() => reject(new Error(`serve-sim exited (${code ?? signal}) ${detail}`.trim())))
        // Only report exits we didn't ask for; stop() removes the entry first.
        if (this.instances.get(deviceId)?.child === child) {
          this.instances.delete(deviceId)
          logger.warn(`[ServeSim] ${deviceId} exited (${code ?? signal})`)
          broadcastExit(deviceId)
        }
      })
    })

    return { child, ready }
  }

  /**
   * Packaged builds unpack serve-sim (native addon + helper executables) out of
   * the ASAR; dev resolves it from the project's node_modules.
   */
  private resolveScript(): string | null {
    const appPath = app.getAppPath()
    const rel = path.join('node_modules', 'serve-sim', 'dist', 'serve-sim.js')
    const candidates = [path.join(appPath.replace('app.asar', 'app.asar.unpacked'), rel), path.join(appPath, rel)]
    return candidates.find((p) => existsSync(p)) ?? null
  }
}

function killGroup(child: ChildProcess): void {
  if (child.exitCode !== null || !child.pid) return
  try { process.kill(-child.pid, 'SIGTERM') } catch {
    try { child.kill('SIGTERM') } catch { /* already gone */ }
  }
}

function broadcastExit(deviceId: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('simulator:serveSimExited', deviceId)
  }
}

let serveSimSession: Session | null = null

/**
 * The preview page is our own loopback server, but it still renders inside a
 * webview: deny every permission except clipboard (copy/paste into the sim).
 * Created eagerly at startup so `session-created` never sees it unconfigured.
 */
export function getServeSimSession(): Session {
  if (!serveSimSession) {
    const allowed = new Set(['clipboard-read', 'clipboard-sanitized-write'])
    serveSimSession = session.fromPartition(SERVE_SIM_PARTITION)
    serveSimSession.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed.has(permission)))
    serveSimSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission))
  }
  return serveSimSession
}

export const serveSimService = new ServeSimService()
