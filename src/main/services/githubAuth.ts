import * as https from 'https'
import { execFile } from 'child_process'
import { BrowserWindow } from 'electron'
import { homedir } from 'os'
import { logger } from '../lib/logger'

// gh CLI's well-known OAuth App client ID
const GH_CLIENT_ID = '178c6fc778ccc68e1d6a'
const GH_SCOPES = 'repo,read:org,gist'

export interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

export type DeviceFlowStatus = 'pending' | 'success' | 'expired' | 'error' | 'cancelled'

export interface DeviceFlowEvent {
  status: DeviceFlowStatus
  token?: string
  error?: string
}

// ── HTTP helper ──────────────────────────────────────────────────────────────

function postForm(url: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const body = new URLSearchParams(params).toString()
  const parsed = new URL(url)

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
          Accept: 'application/json',
        },
      },
      (res) => {
        let data = ''
        res.on('data', (chunk: Buffer) => { data += chunk.toString() })
        res.on('end', () => {
          try {
            resolve(JSON.parse(data))
          } catch {
            reject(new Error(`Invalid JSON response: ${data.slice(0, 200)}`))
          }
        })
      }
    )
    req.on('error', reject)
    req.setTimeout(15_000, () => { req.destroy(); reject(new Error('Request timed out')) })
    req.write(body)
    req.end()
  })
}

// ── Service ──────────────────────────────────────────────────────────────────

class GitHubAuthService {
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private pollIntervalMs = 0

  async requestDeviceCode(): Promise<DeviceCodeResponse> {
    const data = await postForm('https://github.com/login/device/code', {
      client_id: GH_CLIENT_ID,
      scope: GH_SCOPES,
    })

    if (data.error) {
      throw new Error(String(data.error_description || data.error))
    }

    return {
      device_code: String(data.device_code),
      user_code: String(data.user_code),
      verification_uri: String(data.verification_uri),
      expires_in: Number(data.expires_in),
      interval: Number(data.interval) || 5,
    }
  }

  startPolling(deviceCode: string, interval: number, expiresIn: number): void {
    this.cancel() // ensure no concurrent flows

    this.pollIntervalMs = interval * 1000
    const deadline = Date.now() + expiresIn * 1000

    this.schedulePoll(deviceCode, deadline)
  }

  /** Schedules the next poll tick. Rebuilds the timer on slow_down. */
  private schedulePoll(deviceCode: string, deadline: number): void {
    this.pollTimer = setInterval(() => this.pollOnce(deviceCode, deadline), this.pollIntervalMs)
  }

  private async pollOnce(deviceCode: string, deadline: number): Promise<void> {
    if (Date.now() > deadline) {
      this.cancel()
      this.sendEvent({ status: 'expired' })
      return
    }

    try {
      const data = await postForm('https://github.com/login/oauth/access_token', {
        client_id: GH_CLIENT_ID,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      })

      const error = data.error as string | undefined

      if (error === 'authorization_pending') return // keep polling
      if (error === 'slow_down') {
        // GitHub says slow down — increase interval by 5s, rebuild timer
        this.cancel()
        this.pollIntervalMs += 5000
        this.schedulePoll(deviceCode, deadline)
        return
      }
      if (error === 'expired_token') {
        this.cancel()
        this.sendEvent({ status: 'expired' })
        return
      }
      if (error === 'access_denied') {
        this.cancel()
        this.sendEvent({ status: 'error', error: 'Access denied by user' })
        return
      }
      if (error) {
        this.cancel()
        this.sendEvent({ status: 'error', error: String(data.error_description || error) })
        return
      }

      // Success — we have an access token
      const token = data.access_token ? String(data.access_token) : ''
      if (token) {
        this.cancel()
        this.sendEvent({ status: 'success', token })
      }
    } catch (err) {
      logger.error('Device flow poll error', err)
      // Don't cancel on transient network errors — keep polling
    }
  }

  cancel(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  async feedTokenToGh(token: string): Promise<boolean> {
    const userShell = process.env.SHELL || '/bin/zsh'
    return new Promise<boolean>((resolve) => {
      const proc = execFile(
        userShell,
        ['-l', '-c', 'gh auth login --with-token'],
        { timeout: 15_000, cwd: homedir() },
        (err) => resolve(!err)
      )
      proc.stdin?.write(token)
      proc.stdin?.end()
    })
  }

  private sendEvent(event: DeviceFlowEvent): void {
    const wins = BrowserWindow.getAllWindows()
    for (const win of wins) {
      if (!win.isDestroyed()) {
        win.webContents.send('github:deviceFlowEvent', event)
      }
    }
  }
}

export const githubAuthService = new GitHubAuthService()
