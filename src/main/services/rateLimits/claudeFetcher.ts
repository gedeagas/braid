import { readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import path from 'node:path'
import { net, session } from 'electron'
import type { ProviderRateLimits, RateLimitWindow } from '../../../shared/rate-limit-types'

const OAUTH_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const OAUTH_BETA_HEADER = 'oauth-2025-04-20'
const CLAUDE_CODE_USER_AGENT = 'claude-code/2.1.0'
const API_TIMEOUT_MS = 10_000
const PTY_TIMEOUT_MS = 25_000
const MAX_OUTPUT_LENGTH = 100_000

const ACTIVE_CLAUDE_SERVICE = 'Claude Code-credentials'

let proxyConfigured = false

async function ensureProxyFromEnv(): Promise<void> {
  if (proxyConfigured) return
  proxyConfigured = true

  const resolved = await session.defaultSession.resolveProxy(OAUTH_USAGE_URL)
  if (resolved !== 'DIRECT') return

  const proxyUrl =
    process.env.HTTPS_PROXY ??
    process.env.https_proxy ??
    process.env.ALL_PROXY ??
    process.env.all_proxy ??
    process.env.HTTP_PROXY ??
    process.env.http_proxy
  if (!proxyUrl) return

  try {
    new URL(proxyUrl)
    await session.defaultSession.setProxy({ proxyRules: proxyUrl })
  } catch { /* invalid proxy URL - degrade to direct */ }
}

// ---------------------------------------------------------------------------
// Keychain credential reading (macOS)
// ---------------------------------------------------------------------------

type KeychainCredentials = {
  claudeAiOauth?: {
    accessToken?: string
    refreshToken?: string
    expiresAt?: number
  }
}

type OAuthCredentialReadResult = {
  token: string | null
  hasRefreshableCredentials: boolean
}

function parseOAuthCredentialsJson(raw: string): OAuthCredentialReadResult {
  try {
    const parsed = JSON.parse(raw) as KeychainCredentials
    const oauth = parsed?.claudeAiOauth
    const token = oauth?.accessToken
    const refreshToken = oauth?.refreshToken
    const hasRefreshableCredentials = typeof refreshToken === 'string' && refreshToken.trim() !== ''
    if (!token || typeof token !== 'string') {
      return { token: null, hasRefreshableCredentials }
    }
    return { token, hasRefreshableCredentials }
  } catch {
    return { token: null, hasRefreshableCredentials: false }
  }
}

function getKeychainUser(): string {
  return process.env.USER || process.env.USERNAME || 'user'
}

function getActiveClaudeService(configDir?: string): string {
  if (!configDir) return ACTIVE_CLAUDE_SERVICE
  const suffix = createHash('sha256').update(configDir).digest('hex').slice(0, 8)
  return `${ACTIVE_CLAUDE_SERVICE}-${suffix}`
}

function getActiveClaudeServices(configDir?: string): string[] {
  const scopedService = getActiveClaudeService(configDir)
  return scopedService === ACTIVE_CLAUDE_SERVICE
    ? [ACTIVE_CLAUDE_SERVICE]
    : [scopedService, ACTIVE_CLAUDE_SERVICE]
}

function readKeychainPassword(service: string, account: string): Promise<string | null> {
  if (process.platform !== 'darwin') return Promise.resolve(null)
  return new Promise((resolve) => {
    execFile(
      'security',
      ['find-generic-password', '-s', service, '-a', account, '-w'],
      { timeout: 3_000 },
      (error, stdout, stderr) => {
        if (!error && stdout.trim()) {
          resolve(stdout.trim())
          return
        }
        const message = `${stderr} ${error?.message ?? ''}`.toLowerCase()
        const code = (error as { code?: unknown } | null)?.code
        if (code === 44 || message.includes('could not be found') || message.includes('not be found')) {
          resolve(null)
          return
        }
        resolve(null)
      }
    )
  })
}

async function readFromKeychain(configDir?: string): Promise<OAuthCredentialReadResult> {
  if (process.platform !== 'darwin') return { token: null, hasRefreshableCredentials: false }

  const user = getKeychainUser()
  for (const service of getActiveClaudeServices(configDir)) {
    const raw = await readKeychainPassword(service, user)
    if (raw) {
      const result = parseOAuthCredentialsJson(raw)
      if (result.token || result.hasRefreshableCredentials) return result
    }
  }
  return { token: null, hasRefreshableCredentials: false }
}

async function readFromCredentialsFile(configDir?: string): Promise<OAuthCredentialReadResult> {
  const credPath = path.join(configDir ?? path.join(homedir(), '.claude'), '.credentials.json')
  try {
    const raw = await readFile(credPath, 'utf-8')
    return parseOAuthCredentialsJson(raw)
  } catch {
    return { token: null, hasRefreshableCredentials: false }
  }
}

async function readOAuthCredentials(configDir?: string): Promise<OAuthCredentialReadResult> {
  const fromKeychain = await readFromKeychain(configDir)
  if (fromKeychain.token) return fromKeychain
  if (fromKeychain.hasRefreshableCredentials) return fromKeychain

  const fromFile = await readFromCredentialsFile(configDir)
  if (fromFile.token) return fromFile
  if (fromFile.hasRefreshableCredentials) return fromFile

  return { token: null, hasRefreshableCredentials: false }
}

// ---------------------------------------------------------------------------
// OAuth API fetch
// ---------------------------------------------------------------------------

type OAuthUsageWindow = { utilization?: number; resets_at?: string }
type OAuthUsageResponse = { five_hour?: OAuthUsageWindow; seven_day?: OAuthUsageWindow }

function parseResetDescription(isoString: string | undefined): string | null {
  if (!isoString) return null
  try {
    const date = new Date(isoString)
    if (isNaN(date.getTime())) return null
    const now = new Date()
    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    }
    return date.toLocaleDateString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
  } catch { return null }
}

function mapWindow(raw: OAuthUsageWindow | undefined, windowMinutes: number): RateLimitWindow | null {
  if (!raw || typeof raw.utilization !== 'number') return null
  return {
    usedPercent: Math.min(100, Math.max(0, raw.utilization)),
    windowMinutes,
    resetsAt: raw.resets_at ? new Date(raw.resets_at).getTime() || null : null,
    resetDescription: parseResetDescription(raw.resets_at),
  }
}

async function fetchViaOAuth(token: string): Promise<ProviderRateLimits> {
  await ensureProxyFromEnv()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS)
  try {
    const res = await net.fetch(OAUTH_USAGE_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-beta': OAUTH_BETA_HEADER,
        'User-Agent': CLAUDE_CODE_USER_AGENT,
      },
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`OAuth usage API returned ${res.status}`)
    const data = (await res.json()) as OAuthUsageResponse
    return {
      provider: 'claude',
      session: mapWindow(data.five_hour, 300),
      weekly: mapWindow(data.seven_day, 10080),
      updatedAt: Date.now(), error: null, status: 'ok',
    }
  } finally { clearTimeout(timeout) }
}

// ---------------------------------------------------------------------------
// PTY fallback - spawn `claude`, send `/usage`, parse TUI output
// ---------------------------------------------------------------------------

const SESSION_RE = /current\s*session/i
const WEEKLY_RE = /current\s*week/i
const PERCENT_RE = /(\d{1,3})(?:\.\d+)?\s*%\s*(used|left|remaining|available)/i
const RESET_LINE_RE = /resets?\s+(?:at\s+|in\s+)?(.+)/i
const ESC = String.fromCharCode(27)
const BEL = String.fromCharCode(7)
const OSC_RE = new RegExp(`${ESC}\\][^${BEL}]*(?:${BEL}|${ESC}\\\\)`, 'g')
const CSI_RE = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, 'g')

function stripAnsi(s: string): string { return s.replace(OSC_RE, '').replace(CSI_RE, '') }

function extractPercentAfterLabel(lines: string[], labelRe: RegExp): number | null {
  for (let i = 0; i < lines.length; i++) {
    if (!labelRe.test(lines[i])) continue
    for (let j = i; j < Math.min(i + 12, lines.length); j++) {
      const m = PERCENT_RE.exec(lines[j])
      if (m) { const pct = parseFloat(m[1]); return m[2].toLowerCase() === 'used' ? pct : 100 - pct }
    }
  }
  return null
}

function extractResetAfterLabel(lines: string[], labelRe: RegExp): string | null {
  for (let i = 0; i < lines.length; i++) {
    if (!labelRe.test(lines[i])) continue
    for (let j = i; j < Math.min(i + 14, lines.length); j++) {
      const m = RESET_LINE_RE.exec(lines[j])
      if (m) return m[1].trim().replace(/[)]+$/, '')
    }
  }
  return null
}

function parsePtyUsage(output: string): { session: RateLimitWindow | null; weekly: RateLimitWindow | null } {
  const lines = output.split(/\r\n|\n|\r/)
  const sPct = extractPercentAfterLabel(lines, SESSION_RE)
  const wPct = extractPercentAfterLabel(lines, WEEKLY_RE)
  return {
    session: sPct !== null ? { usedPercent: Math.min(100, Math.max(0, sPct)), windowMinutes: 300, resetsAt: null, resetDescription: extractResetAfterLabel(lines, SESSION_RE) } : null,
    weekly: wPct !== null ? { usedPercent: Math.min(100, Math.max(0, wPct)), windowMinutes: 10080, resetsAt: null, resetDescription: extractResetAfterLabel(lines, WEEKLY_RE) } : null,
  }
}

const STOP_SUBSTRINGS = [
  'Current week (all models)', 'Current week (Opus)', 'Current week (Sonnet only)',
  'Current week (Sonnet)', 'Current session', 'Failed to load usage data', 'failed to load usage data',
]
const COMMAND_PALETTE_RE = /show plan|usage limits/i
const TRUST_PROMPT_RE = /do you trust|trust the files|safety check/i
const RATE_LIMITED_RE = /rate limited\.?\s+please try again later/i
const LOAD_FAILED_RE = /failed to load usage data/i
const CLAUDE_21_USAGE_TABS_RE = /settings?\s+status?\s+config\s+usage\s+stats/i
const CLAUDE_21_SESSION_STATS_RE = /total\s*cost|total\s*duration|usage:\s*\d+\s*input/i
const STARTUP_DELAY_MS = 2_000
const SETTLE_AFTER_STOP_MS = 2_000
const SETTLE_AFTER_CLAUDE_21_USAGE_MS = 8_000

function resolveClaudeCommand(): string {
  const { resolveCliPath } = require('../claudePath') as typeof import('../claudePath')
  return resolveCliPath() ?? 'claude'
}

function describeFailure(output: string): string {
  if (RATE_LIMITED_RE.test(output)) return 'Claude usage is rate limited right now.'
  if (LOAD_FAILED_RE.test(output)) return 'Claude usage is unavailable right now.'
  if (CLAUDE_21_USAGE_TABS_RE.test(output) || CLAUDE_21_SESSION_STATS_RE.test(output)) return 'Claude plan usage is unavailable for this CLI session.'
  return 'Claude usage is unavailable right now.'
}

async function fetchViaPty(): Promise<ProviderRateLimits> {
  const pty = await import('node-pty')
  const claudeCommand = resolveClaudeCommand()

  return new Promise<ProviderRateLimits>((resolve) => {
    let output = ''
    let resolved = false
    let sentUsage = false
    let stopDetected = false
    let claude21UsageDetected = false
    let claude21UsageSettleTimer: ReturnType<typeof setTimeout> | null = null

    const term = pty.spawn(claudeCommand, [], {
      name: 'xterm-256color', cols: 120, rows: 40,
      env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
    })
    const disposables: { dispose: () => void }[] = []
    const disposeAll = (): void => { for (const d of disposables.splice(0)) d.dispose() }

    let enterInterval: ReturnType<typeof setInterval> | null = null

    const timeout = setTimeout(() => {
      if (resolved) return
      resolved = true
      if (claude21UsageSettleTimer) clearTimeout(claude21UsageSettleTimer)
      if (enterInterval) clearInterval(enterInterval)
      disposeAll()
      term.kill()
      const clean = stripAnsi(output)
      const { session, weekly } = parsePtyUsage(clean)
      if (session || weekly) {
        resolve({ provider: 'claude', session, weekly, updatedAt: Date.now(), error: null, status: 'ok' })
      } else {
        resolve({
          provider: 'claude', session: null, weekly: null, updatedAt: Date.now(),
          error: CLAUDE_21_USAGE_TABS_RE.test(clean) || CLAUDE_21_SESSION_STATS_RE.test(clean)
            ? describeFailure(clean) : 'PTY timeout',
          status: 'error',
        })
      }
    }, PTY_TIMEOUT_MS)

    function safeWrite(data: string): void {
      try { term.write(data) } catch { /* PTY already closed */ }
    }

    function startEnterPresses(): void {
      if (enterInterval) return
      enterInterval = setInterval(() => { if (!resolved && !stopDetected) safeWrite('\r') }, 800)
    }

    function finalize(): void {
      if (resolved) return
      resolved = true
      clearTimeout(timeout)
      if (claude21UsageSettleTimer) clearTimeout(claude21UsageSettleTimer)
      if (enterInterval) clearInterval(enterInterval)
      disposeAll()
      term.kill()
      const clean = stripAnsi(output)
      const { session, weekly } = parsePtyUsage(clean)
      if (session || weekly) {
        resolve({ provider: 'claude', session, weekly, updatedAt: Date.now(), error: null, status: 'ok' })
      } else {
        resolve({ provider: 'claude', session: null, weekly: null, updatedAt: Date.now(), error: describeFailure(clean), status: 'error' })
      }
    }

    setTimeout(() => {
      if (resolved) return
      sentUsage = true
      safeWrite('/usage\r')
      startEnterPresses()
    }, STARTUP_DELAY_MS)

    const onData = term.onData((data) => {
      output += data
      if (output.length > MAX_OUTPUT_LENGTH) output = output.slice(-MAX_OUTPUT_LENGTH)

      const chunk = stripAnsi(data)
      if (TRUST_PROMPT_RE.test(chunk)) { safeWrite('y\r'); return }
      if (sentUsage && COMMAND_PALETTE_RE.test(chunk)) safeWrite('\r')

      if (sentUsage && !stopDetected) {
        const clean = stripAnsi(output)
        if (!claude21UsageDetected && (CLAUDE_21_USAGE_TABS_RE.test(clean) || CLAUDE_21_SESSION_STATS_RE.test(clean))) {
          claude21UsageDetected = true
          if (enterInterval) { clearInterval(enterInterval); enterInterval = null }
          claude21UsageSettleTimer = setTimeout(finalize, SETTLE_AFTER_CLAUDE_21_USAGE_MS)
        }
        for (const sub of STOP_SUBSTRINGS) {
          if (clean.includes(sub)) {
            stopDetected = true
            setTimeout(finalize, SETTLE_AFTER_STOP_MS)
            break
          }
        }
      }
    })
    if (onData) disposables.push(onData)

    const onExit = term.onExit(() => {
      disposeAll()
      if (claude21UsageSettleTimer) clearTimeout(claude21UsageSettleTimer)
      if (enterInterval) { clearInterval(enterInterval); enterInterval = null }
      if (!resolved) {
        resolved = true
        clearTimeout(timeout)
        const clean = stripAnsi(output)
        const { session, weekly } = parsePtyUsage(clean)
        resolve({
          provider: 'claude', session, weekly, updatedAt: Date.now(),
          error: session || weekly ? null : 'CLI exited before /usage rendered',
          status: session || weekly ? 'ok' : 'error',
        })
      }
    })
    if (onExit) disposables.push(onExit)
  })
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function fetchClaudeRateLimits(): Promise<ProviderRateLimits> {
  const oauthCredentials = await readOAuthCredentials()

  if (oauthCredentials.token) {
    try {
      return await fetchViaOAuth(oauthCredentials.token)
    } catch {
      // OAuth API failed - fall through to PTY
    }
  }

  if (oauthCredentials.token || oauthCredentials.hasRefreshableCredentials) {
    try {
      return await fetchViaPty()
    } catch (err) {
      return {
        provider: 'claude', session: null, weekly: null, updatedAt: Date.now(),
        error: err instanceof Error ? err.message : 'Unknown error', status: 'error',
      }
    }
  }

  return {
    provider: 'claude', session: null, weekly: null, updatedAt: Date.now(),
    error: 'No subscription plan', status: 'unavailable',
  }
}
