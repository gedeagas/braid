import type { BrowserWindow } from 'electron'
import type { ProviderRateLimits, RateLimitState } from '../../../shared/rate-limit-types'
import { fetchClaudeRateLimits } from './claudeFetcher'
import { fetchCodexRateLimits } from './codexFetcher'

const DEFAULT_POLL_MS = 15 * 60 * 1000
const MIN_REFETCH_MS = 5 * 60 * 1000
const STALE_THRESHOLD_MS = 30 * 60 * 1000

type InternalState = {
  claude: ProviderRateLimits | null
  codex: ProviderRateLimits | null
}

export class RateLimitService {
  private state: InternalState = { claude: null, codex: null }
  private timer: ReturnType<typeof setInterval> | null = null
  private lastFetchAt = 0
  private mainWindow: BrowserWindow | null = null
  private detachListeners: (() => void) | null = null
  private isFetching = false
  private queuedRefresh = false

  attach(mainWindow: BrowserWindow): void {
    this.detachListeners?.()
    this.mainWindow = mainWindow

    const refreshOnResume = (): void => { void this.refreshIfStale() }
    mainWindow.on('focus', refreshOnResume)
    mainWindow.on('show', refreshOnResume)
    mainWindow.on('restore', refreshOnResume)

    this.detachListeners = () => {
      mainWindow.removeListener('focus', refreshOnResume)
      mainWindow.removeListener('show', refreshOnResume)
      mainWindow.removeListener('restore', refreshOnResume)
    }

    mainWindow.on('closed', () => {
      this.detachListeners?.()
      this.detachListeners = null
      if (this.mainWindow === mainWindow) this.mainWindow = null
    })
  }

  start(): void {
    void this.fetchAll()
    this.startTimer()
  }

  stop(): void {
    this.stopTimer()
    this.detachListeners?.()
    this.detachListeners = null
    this.mainWindow = null
  }

  getState(): RateLimitState {
    return { ...this.state }
  }

  async refresh(): Promise<RateLimitState> {
    await this.fetchAll({ force: true })
    return this.getState()
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private startTimer(): void {
    this.stopTimer()
    this.timer = setInterval(() => {
      if (this.shouldPoll()) void this.fetchAll()
    }, DEFAULT_POLL_MS)
  }

  private stopTimer(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
  }

  private shouldPoll(): boolean {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return false
    if (!this.mainWindow.isVisible() || this.mainWindow.isMinimized()) return false
    return this.mainWindow.isFocused()
  }

  private async refreshIfStale(): Promise<void> {
    if (!this.shouldPoll()) return
    if (Date.now() - this.lastFetchAt < MIN_REFETCH_MS) return
    await this.fetchAll()
  }

  private async fetchAll(options?: { force?: boolean }): Promise<void> {
    if (this.isFetching) {
      if (options?.force) this.queuedRefresh = true
      return
    }
    this.isFetching = true

    try {
      await this.runFetchCycle()
      if (this.queuedRefresh) {
        this.queuedRefresh = false
        await this.runFetchCycle()
      }
    } finally {
      this.isFetching = false
    }
  }

  private async runFetchCycle(): Promise<void> {
    const previous = this.state

    this.updateState({
      claude: this.withFetchingStatus(previous.claude, 'claude'),
      codex: this.withFetchingStatus(previous.codex, 'codex'),
    })

    const [claudeResult, codexResult] = await Promise.allSettled([
      fetchClaudeRateLimits(),
      fetchCodexRateLimits(),
    ])

    const claude: ProviderRateLimits = claudeResult.status === 'fulfilled'
      ? claudeResult.value
      : { provider: 'claude', session: null, weekly: null, updatedAt: Date.now(), error: claudeResult.reason instanceof Error ? claudeResult.reason.message : 'Unknown error', status: 'error' }

    const codex: ProviderRateLimits = codexResult.status === 'fulfilled'
      ? codexResult.value
      : { provider: 'codex', session: null, weekly: null, updatedAt: Date.now(), error: codexResult.reason instanceof Error ? codexResult.reason.message : 'Unknown error', status: 'error' }

    this.updateState({
      claude: this.applyStalePolicy(claude, previous.claude),
      codex: this.applyStalePolicy(codex, previous.codex),
    })

    this.lastFetchAt = Date.now()
  }

  private withFetchingStatus(current: ProviderRateLimits | null, provider: 'claude' | 'codex'): ProviderRateLimits {
    if (!current) {
      return { provider, session: null, weekly: null, updatedAt: 0, error: null, status: 'fetching' }
    }
    return { ...current, status: 'fetching' }
  }

  private applyStalePolicy(fresh: ProviderRateLimits, previous: ProviderRateLimits | null): ProviderRateLimits {
    if (fresh.status === 'ok' || fresh.status === 'unavailable') return fresh
    if (!previous || (!previous.session && !previous.weekly)) return fresh
    if (Date.now() - previous.updatedAt > STALE_THRESHOLD_MS) return fresh
    return { ...previous, error: fresh.error, status: 'error' }
  }

  private updateState(next: InternalState): void {
    this.state = next
    this.pushToRenderer()
  }

  private pushToRenderer(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return
    this.mainWindow.webContents.send('rateLimits:update', this.getState())
  }
}

// Module singleton: the renderer IPC handlers and the mobile RPC bridge share
// one instance so both report the same cached usage without re-fetching.
export const rateLimitService = new RateLimitService()
