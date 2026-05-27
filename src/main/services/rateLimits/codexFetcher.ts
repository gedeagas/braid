import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import type { ProviderRateLimits, RateLimitWindow } from '../../../shared/rate-limit-types'

const RPC_TIMEOUT_MS = 10_000
const PTY_TIMEOUT_MS = 15_000
const MAX_DIAGNOSTIC_OUTPUT_LENGTH = 100_000

// ---------------------------------------------------------------------------
// Resolve codex binary - checks PATH then version manager directories
// ---------------------------------------------------------------------------

function getExecutableNames(commandName: string): string[] {
  if (process.platform === 'win32') {
    return [`${commandName}.cmd`, `${commandName}.exe`, `${commandName}.bat`, commandName]
  }
  return [commandName]
}

function findFirstExecutable(dirs: string[], names: string[]): string | null {
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = join(dir, name)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

function resolveCodexCommand(): string {
  const names = getExecutableNames('codex')
  const pathEnv = process.env.PATH ?? process.env.Path ?? ''
  const pathDirs = pathEnv.split(delimiter).map(e => e.trim()).filter(Boolean)
  const pathCandidate = findFirstExecutable(pathDirs, names)
  if (pathCandidate) return pathCandidate

  const home = homedir()
  const versionManagerDirs = [
    join(home, '.volta', 'bin'),
    join(home, '.asdf', 'shims'),
    join(home, '.fnm', 'aliases', 'default', 'bin'),
    join(home, '.local', 'share', 'mise', 'shims'),
    join(home, '.local', 'bin'),
    join(home, '.bun', 'bin'),
  ]
  if (process.platform === 'darwin') {
    versionManagerDirs.push(join(home, 'Library', 'pnpm'))
  } else if (process.platform !== 'win32') {
    versionManagerDirs.push(join(home, '.local', 'share', 'pnpm'))
  }
  versionManagerDirs.push(join(home, '.yarn', 'bin'))

  const nvmDir = join(home, '.nvm', 'versions', 'node')
  if (existsSync(nvmDir)) {
    try {
      const versions = readdirSync(nvmDir, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name)
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
        .map(v => join(nvmDir, v, 'bin'))
      const nvmMatch = findFirstExecutable(versions, names)
      if (nvmMatch) versionManagerDirs.unshift(dirname(nvmMatch))
    } catch { /* nvm dir unreadable */ }
  }

  const vmCandidate = findFirstExecutable(versionManagerDirs, names)
  return vmCandidate ?? 'codex'
}

// ---------------------------------------------------------------------------
// JSON-RPC
// ---------------------------------------------------------------------------

type RpcResponse = { id: number; result?: unknown; error?: { code: number; message: string } }
type RpcRateWindow = { usedPercent?: number; windowDurationMins?: number; resetsAt?: number }
type RpcRateLimitsResponse = { rateLimits?: { primary?: RpcRateWindow; secondary?: RpcRateWindow } }

function buildRpcMessage(id: number, method: string, params?: unknown): string {
  return `${JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} })}\n`
}

function mapRpcWindow(raw: RpcRateWindow | undefined, expectedMinutes: number): RateLimitWindow | null {
  if (!raw || typeof raw.usedPercent !== 'number') return null
  let resetDescription: string | null = null
  let resetsAt: number | null = null
  if (raw.resetsAt) {
    const date = new Date(raw.resetsAt * 1000)
    if (!isNaN(date.getTime())) {
      resetsAt = date.getTime()
      const now = new Date()
      resetDescription = date.toDateString() === now.toDateString()
        ? date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
        : date.toLocaleDateString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
    }
  }
  return { usedPercent: Math.min(100, Math.max(0, raw.usedPercent)), windowMinutes: expectedMinutes, resetsAt, resetDescription }
}

async function fetchViaRpc(): Promise<ProviderRateLimits> {
  return new Promise<ProviderRateLimits>((resolve) => {
    let buffer = ''
    let stderr = ''
    let resolved = false
    let rpcId = 0
    let rateLimitsId: number | null = null

    const codexCommand = resolveCodexCommand()
    const child = spawn(codexCommand, ['-s', 'read-only', '-a', 'untrusted', 'app-server'], {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env },
    })

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true; child.kill()
        resolve({ provider: 'codex', session: null, weekly: null, updatedAt: Date.now(), error: 'RPC timeout', status: 'error' })
      }
    }, RPC_TIMEOUT_MS)

    function sendRpc(method: string, params?: unknown): number {
      const id = ++rpcId; child.stdin.write(buildRpcMessage(id, method, params)); return id
    }
    function sendNotification(method: string): void {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params: {} })}\n`)
    }

    const initId = sendRpc('initialize', { clientInfo: { name: 'braid', version: '1.0.0' } })

    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      let idx: number
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim()
        buffer = buffer.slice(idx + 1)
        if (!line) continue
        try {
          const msg = JSON.parse(line) as RpcResponse
          if (msg.id == null) continue
          if (msg.id === initId) {
            sendNotification('initialized')
            rateLimitsId = sendRpc('account/rateLimits/read')
            continue
          }
          if (rateLimitsId !== null && msg.id === rateLimitsId) {
            if (resolved) return
            resolved = true; clearTimeout(timeout); child.kill()
            if (msg.error) {
              resolve({ provider: 'codex', session: null, weekly: null, updatedAt: Date.now(), error: msg.error.message, status: 'error' })
              return
            }
            const wrapper = msg.result as RpcRateLimitsResponse | undefined
            const result = wrapper?.rateLimits
            resolve({
              provider: 'codex', session: mapRpcWindow(result?.primary, 300),
              weekly: mapRpcWindow(result?.secondary, 10080), updatedAt: Date.now(), error: null, status: 'ok',
            })
          }
        } catch { /* non-JSON */ }
      }
    })

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
      if (stderr.length > MAX_DIAGNOSTIC_OUTPUT_LENGTH) stderr = stderr.slice(-MAX_DIAGNOSTIC_OUTPUT_LENGTH)
    })

    child.on('error', (err) => {
      if (!resolved) {
        resolved = true; clearTimeout(timeout)
        const isEnoent = (err as NodeJS.ErrnoException).code === 'ENOENT'
        const isBare = resolveCodexCommand() === 'codex'
        resolve({
          provider: 'codex', session: null, weekly: null, updatedAt: Date.now(),
          error: isEnoent
            ? isBare ? 'Codex CLI not found' : 'Codex CLI found but could not run'
            : err.message,
          status: isEnoent && isBare ? 'unavailable' : 'error',
        })
      }
    })

    child.on('close', () => {
      if (!resolved) {
        resolved = true; clearTimeout(timeout)
        resolve({ provider: 'codex', session: null, weekly: null, updatedAt: Date.now(), error: 'RPC process exited unexpectedly', status: 'error' })
      }
    })
  })
}

// ---------------------------------------------------------------------------
// PTY fallback - spawn `codex`, send `/status`, parse output
// ---------------------------------------------------------------------------

const FIVE_HOUR_RE = /5h\s+limit[:\s]*(\d+)%/i
const WEEKLY_RE = /weekly\s+limit[:\s]*(\d+)%/i
const RESET_TEXT_RE = /resets?\s+(?:at\s+|in\s+)?(.+)/i

function parsePtyStatus(output: string): { session: RateLimitWindow | null; weekly: RateLimitWindow | null } {
  const fiveMatch = FIVE_HOUR_RE.exec(output)
  const weeklyMatch = WEEKLY_RE.exec(output)

  const session: RateLimitWindow | null = fiveMatch
    ? { usedPercent: Math.min(100, parseInt(fiveMatch[1], 10)), windowMinutes: 300, resetsAt: null, resetDescription: null }
    : null
  const weekly: RateLimitWindow | null = weeklyMatch
    ? { usedPercent: Math.min(100, parseInt(weeklyMatch[1], 10)), windowMinutes: 10080, resetsAt: null, resetDescription: null }
    : null

  const resetMatch = RESET_TEXT_RE.exec(output)
  if (resetMatch && session) session.resetDescription = resetMatch[1].trim()

  return { session, weekly }
}

async function fetchViaPty(): Promise<ProviderRateLimits> {
  const pty = await import('node-pty')
  const codexCommand = resolveCodexCommand()

  return new Promise<ProviderRateLimits>((resolve) => {
    let output = ''
    let resolved = false
    let sentStatus = false

    const term = pty.spawn(codexCommand, [], {
      name: 'xterm-256color', cols: 120, rows: 40,
      env: { ...process.env, TERM: 'xterm-256color' },
    })
    const disposables: { dispose: () => void }[] = []
    const disposeAll = (): void => { for (const d of disposables.splice(0)) d.dispose() }

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true; disposeAll(); term.kill()
        resolve({ provider: 'codex', session: null, weekly: null, updatedAt: Date.now(), error: 'PTY timeout', status: 'error' })
      }
    }, PTY_TIMEOUT_MS)

    const onData = term.onData((data) => {
      output += data
      if (!sentStatus && />\s*$/.test(data)) { sentStatus = true; term.write('/status\r'); return }
      if (sentStatus && (FIVE_HOUR_RE.test(output) || WEEKLY_RE.test(output))) {
        setTimeout(() => {
          if (resolved) return
          resolved = true; clearTimeout(timeout); disposeAll(); term.kill()
          // eslint-disable-next-line no-control-regex
          const clean = output.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
          const { session, weekly } = parsePtyStatus(clean)
          resolve({
            provider: 'codex', session, weekly, updatedAt: Date.now(),
            error: session || weekly ? null : 'Failed to parse CLI output',
            status: session || weekly ? 'ok' : 'error',
          })
        }, 500)
      }
    })
    if (onData) disposables.push(onData)

    const onExit = term.onExit(() => {
      disposeAll()
      if (!resolved) {
        resolved = true; clearTimeout(timeout)
        // eslint-disable-next-line no-control-regex
        const clean = output.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
        const { session, weekly } = parsePtyStatus(clean)
        resolve({
          provider: 'codex', session, weekly, updatedAt: Date.now(),
          error: session || weekly ? null : 'CLI exited before status available',
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

export async function fetchCodexRateLimits(): Promise<ProviderRateLimits> {
  try {
    const rpcResult = await fetchViaRpc()
    if (rpcResult.status === 'ok' || rpcResult.status === 'unavailable') return rpcResult
  } catch { /* RPC failed */ }

  try {
    return await fetchViaPty()
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    const isNotInstalled = message.includes('ENOENT')
    return {
      provider: 'codex', session: null, weekly: null, updatedAt: Date.now(),
      error: isNotInstalled ? 'Codex CLI not found' : message,
      status: isNotInstalled ? 'unavailable' : 'error',
    }
  }
}
