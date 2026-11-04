// Delivers PTY output from main to the renderer in batches, with two-stage
// backpressure:
//
//  - Batching: output is queued per terminal and flushed every 2ms in slices
//    of at most 16KB, at most 2 slices per terminal per flush. If output is
//    still waiting, the next flush runs 1ms later.
//  - Stage A (renderer limit, RendererBudget): only send while the renderer
//    has acknowledged enough of what it already got.
//  - Stage B (producer pause, ProducerPause): when a terminal's queue backs up,
//    pause the program writing to it. Only with a producer that supports it.
//
// Used by both the daemon adapter and the in-process PtyService.

import { OutputQueue } from './outputQueue'
import { ProducerPause, type PauseLimits } from './producerPause'
import { RendererBudget, type BudgetLimits } from './rendererBudget'
import { nextSlice, SYNC_END } from './sliceOutput'

const KB = 1024
const MB = 1024 * KB
/** Prefix shared by the DEC 2026 begin and end markers. */
const SYNC_MARK = '\x1b[?2026'

export interface DeliverySink {
  /** Send output to the renderer. Returns false when no renderer received it. */
  send(id: string, data: string): boolean
  pause(id: string): void
  resume(id: string): void
}

export interface DeliveryConfig {
  flushMs: number
  followUpMs: number
  sliceChars: number
  slicesPerFlush: number
  /** A DEC 2026 frame up to this size is never split across slices. */
  maxSyncFrame: number
  /** How long an unfinished frame at the head is held before it is sent anyway. */
  syncHoldMs: number
  budget: BudgetLimits
  pause: PauseLimits
  /**
   * Past this many queued characters a terminal is sent regardless of the
   * renderer limit, so main's memory stays bounded when the producer can't be
   * paused (a daemon without flow control).
   */
  bypassQueue: number
  /**
   * After a reset (reload, crash) nothing is sent until the new page says its
   * pty:data listener is up; output sent before that is never acknowledged and
   * would pin the renderer limit. A lost signal opens the gate after this long.
   */
  rendererReadyWatchdogMs: number
}

export const DEFAULT_DELIVERY_CONFIG: DeliveryConfig = {
  flushMs: 2,
  followUpMs: 1,
  sliceChars: 16 * KB,
  slicesPerFlush: 2,
  maxSyncFrame: 256 * KB,
  syncHoldMs: 100,
  budget: { perTerminal: 512 * KB, total: 8 * MB, interactivePerTerminal: 512 * KB, interactiveTotal: 256 * KB },
  pause: { high: 256 * KB, low: 32 * KB, repeatMs: 5_000 },
  bypassQueue: 8 * MB,
  rendererReadyWatchdogMs: 10_000,
}

export class OutputDelivery {
  protected queues = new Map<string, OutputQueue>()
  protected budget: RendererBudget
  private pauser: ProducerPause
  private timer: ReturnType<typeof setTimeout> | null = null
  private timerAt = Infinity
  /** Terminal the user last typed into. */
  protected focused: string | null = null
  private rendererReady = true
  private readyWatchdog: ReturnType<typeof setTimeout> | null = null

  constructor(protected sink: DeliverySink, protected config: DeliveryConfig = DEFAULT_DELIVERY_CONFIG) {
    this.budget = new RendererBudget(config.budget)
    this.pauser = new ProducerPause(sink, config.pause)
  }

  /** The renderer's pty:data listener is up: start (or resume) sending. */
  setRendererReady(): void {
    if (this.readyWatchdog) clearTimeout(this.readyWatchdog)
    this.readyWatchdog = null
    if (this.rendererReady) return
    this.rendererReady = true
    if ([...this.queues.values()].some((q) => q.length > 0)) this.schedule(0)
  }

  /** Enable Stage B when the producer supports pausing. */
  setProducerPause(enabled: boolean): void {
    this.pauser.setEnabled(enabled)
  }

  /** The producer connection dropped; it resumes its sessions by itself. */
  forgetProducerPauses(): void {
    this.pauser.forgetAll()
  }

  push(id: string, data: string, seq = 0): void {
    if (!data) return
    const q = this.queue(id)
    q.push(data, seq)
    this.pauser.update(id, q.length)
    this.schedule(this.config.flushMs)
  }

  /** Renderer's running total of processed characters for a terminal. */
  ack(id: string, processedTotal: number): void {
    if (this.budget.ack(id, processedTotal) && this.queued(id) > 0) this.schedule(this.config.followUpMs)
  }

  setFocused(id: string | null): void {
    this.focused = id
  }

  queued(id: string): number {
    return this.queues.get(id)?.length ?? 0
  }

  unacked(id: string): number {
    return this.budget.unacked(id)
  }

  totalUnacked(): number {
    return this.budget.totalUnacked()
  }

  /** Send everything still queued (the terminal exited), then forget it. */
  drain(id: string): void {
    const q = this.queues.get(id)
    while (q && q.length > 0) this.sendSlice(id, q.take(this.config.sliceChars))
    this.remove(id)
  }

  /** Forget a terminal without sending what is queued. */
  remove(id: string): void {
    this.queues.delete(id)
    this.budget.remove(id)
    this.pauser.forget(id)
  }

  /** Renderer reloaded or crashed: start over and let every producer run. */
  reset(): void {
    this.budget.reset()
    for (const q of this.queues.values()) q.clear()
    this.pauser.resumeAll()
    // Hold output until the new page listens (see rendererReadyWatchdogMs).
    this.rendererReady = false
    if (this.readyWatchdog) clearTimeout(this.readyWatchdog)
    this.readyWatchdog = setTimeout(() => {
      this.readyWatchdog = null
      this.setRendererReady()
    }, this.config.rendererReadyWatchdogMs)
    this.readyWatchdog.unref?.()
  }

  dispose(): void {
    if (this.readyWatchdog) clearTimeout(this.readyWatchdog)
    this.readyWatchdog = null
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.timerAt = Infinity
    this.pauser.dispose()
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  protected queue(id: string): OutputQueue {
    let q = this.queues.get(id)
    if (!q) {
      q = new OutputQueue()
      this.queues.set(id, q)
    }
    return q
  }

  /** Terminals in the order a flush serves them. */
  protected order(): Iterable<string> {
    return this.queues.keys()
  }

  protected sendSlice(id: string, data: string): void {
    // A page without a listener would never ack it (drain on exit, mid-reload).
    if (!this.rendererReady) return
    if (data && this.sink.send(id, data)) this.budget.onSent(id, data.length)
  }

  /** Gets the extra room for the terminal the user is interacting with. */
  protected isInteractive(id: string): boolean {
    return id === this.focused
  }

  protected schedule(delayMs: number): void {
    const at = Date.now() + delayMs
    if (this.timer && this.timerAt <= at) return
    if (this.timer) clearTimeout(this.timer)
    this.timerAt = at
    this.timer = setTimeout(() => this.flush(), delayMs)
  }

  /** Characters to send next from `q`, or 0 while an unfinished frame is held. */
  private nextLength(q: OutputQueue, now: number): number {
    const { sliceChars, maxSyncFrame, syncHoldMs } = this.config
    const force = q.holdSince !== null && now - q.holdSince >= syncHoldMs
    let text = q.peek(sliceChars + SYNC_MARK.length + 1)
    if (q.headInFrame || text.includes(SYNC_MARK)) text = q.peek(sliceChars + maxSyncFrame + SYNC_END.length)
    const slice = nextSlice(text, { maxChars: sliceChars, maxSyncFrame }, { headInFrame: q.headInFrame, force })
    if (slice.length === 0) {
      if (q.holdSince === null) q.holdSince = now
      return 0
    }
    q.holdSince = null
    q.headInFrame = slice.splitFrame
    return slice.length
  }

  /** Whether output for this terminal may go to the renderer right now. */
  protected canDeliver(_id: string): boolean {
    return this.rendererReady
  }

  protected flush(): void {
    this.timer = null
    this.timerAt = Infinity
    const { slicesPerFlush, bypassQueue, followUpMs, syncHoldMs } = this.config
    const now = Date.now()
    let followUp = false
    let holdUntil = Infinity

    for (const id of this.order()) {
      const q = this.queues.get(id)
      if (!q || q.length === 0 || !this.canDeliver(id)) continue
      let slices = 0
      while (q.length > 0) {
        const bypass = q.length > bypassQueue
        if (!bypass && (slices >= slicesPerFlush || !this.budget.canSend(id, this.isInteractive(id)))) break
        const n = this.nextLength(q, now)
        if (n === 0) {
          holdUntil = Math.min(holdUntil, (q.holdSince ?? now) + syncHoldMs)
          break
        }
        this.sendSlice(id, q.take(n))
        slices++
      }
      this.pauser.update(id, q.length)
      if (q.length > 0 && q.holdSince === null && this.budget.canSend(id, this.isInteractive(id))) followUp = true
    }

    if (followUp) this.schedule(followUpMs)
    else if (holdUntil < Infinity) this.schedule(Math.max(0, holdUntil - now))
  }
}
