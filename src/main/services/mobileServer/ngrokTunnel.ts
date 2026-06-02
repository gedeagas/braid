import { spawn, type ChildProcessByStdio } from 'child_process'
import type { Readable } from 'stream'
import { logger } from '../../lib/logger'
import { enrichedEnv } from '../../lib/enrichedEnv'
import type { MobileNgrokTunnelStatus } from './types'

const NGROK_START_TIMEOUT_MS = 15_000

type PendingStart = {
  resolve: (status: MobileNgrokTunnelStatus) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export function toWebSocketEndpoint(publicUrl: string): string | null {
  try {
    const parsed = new URL(publicUrl)
    if (parsed.protocol === 'https:') parsed.protocol = 'wss:'
    else if (parsed.protocol === 'http:') parsed.protocol = 'ws:'
    else return null
    parsed.pathname = ''
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

export function extractNgrokPublicUrl(line: string): string | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  try {
    const parsed = JSON.parse(trimmed) as { url?: unknown; msg?: unknown }
    if (typeof parsed.url === 'string') return parsed.url
  } catch {
    // ngrok can emit text logs depending on local config/version.
  }

  const urlField = trimmed.match(/\burl=(https?:\/\/[^\s'",]+)/i)
  if (urlField?.[1]) return urlField[1]

  const matches = [...trimmed.matchAll(/https?:\/\/[^\s'",]+/gi)].map((match) => match[0])
  return matches.find(isLikelyNgrokUrl) ?? matches[0] ?? null
}

function isLikelyNgrokUrl(value: string): boolean {
  try {
    return new URL(value).hostname.includes('ngrok')
  } catch {
    return false
  }
}

class MobileNgrokTunnel {
  private proc: ChildProcessByStdio<null, Readable, Readable> | null = null
  private port: number | null = null
  private url: string | null = null
  private endpoint: string | null = null
  private startedAt: number | null = null
  private error: string | null = null
  private stdoutBuffer = ''
  private stderrBuffer = ''
  private pendingStart: PendingStart | null = null
  private stopping = false

  async start(port: number): Promise<MobileNgrokTunnelStatus> {
    if (this.proc && this.port === port && this.endpoint) {
      return this.getStatus()
    }
    if (this.pendingStart && this.port === port) {
      return new Promise((resolve, reject) => {
        const previous = this.pendingStart!
        this.pendingStart = {
          timer: previous.timer,
          resolve: (status) => {
            previous.resolve(status)
            resolve(status)
          },
          reject: (err) => {
            previous.reject(err)
            reject(err)
          },
        }
      })
    }

    this.stop()
    this.port = port
    this.url = null
    this.endpoint = null
    this.startedAt = Date.now()
    this.error = null
    this.stdoutBuffer = ''
    this.stderrBuffer = ''

    const args = ['http', String(port), '--log', 'stdout', '--log-format', 'json']
    logger.info(`[MobileNgrokTunnel] Starting ngrok for port ${port}`)
    this.stopping = false
    const proc = spawn('ngrok', args, {
      env: enrichedEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    this.proc = proc

    proc.stdout.on('data', (chunk) => {
      if (this.proc !== proc) return
      this.stdoutBuffer = this.handleChunk(this.stdoutBuffer, chunk)
    })
    proc.stderr.on('data', (chunk) => {
      if (this.proc !== proc) return
      this.stderrBuffer = this.handleChunk(this.stderrBuffer, chunk)
    })
    proc.on('error', (err: NodeJS.ErrnoException) => {
      if (this.proc !== proc) return
      const message = err.code === 'ENOENT'
        ? 'ngrok CLI was not found. Install ngrok and configure your auth token, then try again.'
        : err.message
      this.failStart(new Error(message))
      this.clearProcess(message)
    })
    proc.on('exit', (code, signal) => {
      if (this.proc !== proc) return
      const message = code === 0
        ? 'ngrok tunnel stopped'
        : `ngrok exited${code === null ? '' : ` with code ${code}`}${signal ? ` (${signal})` : ''}`
      const detail = this.error ?? message
      if (this.pendingStart) this.failStart(new Error(detail))
      this.clearProcess(this.stopping ? null : detail)
    })

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const message = 'Timed out waiting for ngrok to report a public URL.'
        this.failStart(new Error(message))
        this.stop()
      }, NGROK_START_TIMEOUT_MS)
      this.pendingStart = { resolve, reject, timer }
    })
  }

  stop(): void {
    const proc = this.proc
    if (this.pendingStart) {
      this.failStart(new Error('ngrok tunnel stopped before it became ready'))
    }
    this.stopping = true
    this.proc = null
    this.port = null
    this.url = null
    this.endpoint = null
    this.startedAt = null
    this.stdoutBuffer = ''
    this.stderrBuffer = ''
    this.error = null
    if (proc && !proc.killed) {
      proc.kill()
    }
  }

  getStatus(): MobileNgrokTunnelStatus {
    return {
      running: this.proc !== null && this.endpoint !== null,
      port: this.port,
      url: this.url,
      endpoint: this.endpoint,
      startedAt: this.startedAt,
      error: this.error,
    }
  }

  private handleChunk(buffer: string, chunk: Buffer): string {
    const combined = buffer + chunk.toString('utf8')
    const lines = combined.split(/\r?\n/)
    const nextBuffer = lines.pop() ?? ''
    for (const line of lines) this.handleLine(line)
    return nextBuffer
  }

  private handleLine(line: string): void {
    const publicUrl = extractNgrokPublicUrl(line)
    if (!publicUrl) {
      const trimmed = line.trim()
      if (trimmed && /error|failed|unauthorized|authtoken/i.test(trimmed)) {
        this.error = trimmed
      }
      return
    }

    const endpoint = toWebSocketEndpoint(publicUrl)
    if (!endpoint) return
    this.url = publicUrl
    this.endpoint = endpoint
    this.error = null
    logger.info(`[MobileNgrokTunnel] Public endpoint ready: ${endpoint}`)
    if (!this.pendingStart) return
    const pending = this.pendingStart
    this.pendingStart = null
    clearTimeout(pending.timer)
    pending.resolve(this.getStatus())
  }

  private failStart(err: Error): void {
    if (!this.pendingStart) return
    const pending = this.pendingStart
    this.pendingStart = null
    clearTimeout(pending.timer)
    this.error = err.message
    pending.reject(err)
  }

  private clearProcess(message: string | null): void {
    this.proc = null
    this.stopping = false
    this.url = null
    this.endpoint = null
    this.startedAt = null
    this.error = message
  }
}

export const mobileNgrokTunnel = new MobileNgrokTunnel()
