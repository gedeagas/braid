// Stage A of output flow control: bound how much PTY output can be in flight
// to the renderer (sent over IPC but not yet parsed by xterm).
//
// The renderer acknowledges with a running total of characters it has
// processed per terminal. Unacknowledged output = sent - processed. A total is
// only accepted when it is higher than the last one seen, so reordered or
// repeated acks are harmless; a renderer reload is handled by reset().

export interface BudgetLimits {
  /** Unacknowledged characters allowed per terminal. */
  perTerminal: number
  /** Unacknowledged characters allowed across all counted terminals. */
  total: number
  /**
   * Extra room, on top of both limits, for the terminal the user is
   * interacting with, so it stays responsive while background terminals are
   * at their limits (without letting every background terminal burst).
   */
  interactivePerTerminal: number
  interactiveTotal: number
}

interface Counts {
  sent: number
  processed: number
}

export class RendererBudget {
  private counts = new Map<string, Counts>()
  /** Terminals left out of the total (hidden ones, once offloaded). */
  private uncounted = new Set<string>()
  private total = 0

  constructor(private limits: BudgetLimits) {}

  private get(id: string): Counts {
    let c = this.counts.get(id)
    if (!c) {
      c = { sent: 0, processed: 0 }
      this.counts.set(id, c)
    }
    return c
  }

  private static unackedOf(c: Counts | undefined): number {
    return c ? Math.max(0, c.sent - c.processed) : 0
  }

  unacked(id: string): number {
    return RendererBudget.unackedOf(this.counts.get(id))
  }

  totalUnacked(): number {
    return this.total
  }

  /** Room left for this terminal under both limits. */
  canSend(id: string, interactive = false): boolean {
    const { perTerminal, total, interactivePerTerminal, interactiveTotal } = this.limits
    if (this.unacked(id) >= perTerminal + (interactive ? interactivePerTerminal : 0)) return false
    if (this.uncounted.has(id)) return true
    return this.total < total + (interactive ? interactiveTotal : 0)
  }

  onSent(id: string, chars: number): void {
    const c = this.get(id)
    const before = RendererBudget.unackedOf(c)
    c.sent += chars
    this.adjust(id, RendererBudget.unackedOf(c) - before)
  }

  /** Record the renderer's running total. Returns false when it was ignored. */
  ack(id: string, processedTotal: number): boolean {
    if (!Number.isFinite(processedTotal) || processedTotal < 0) return false
    const c = this.get(id)
    // Never beyond what was sent: a stale or corrupt total can't create credit.
    const next = Math.min(c.sent, processedTotal)
    if (next <= c.processed) return false
    const before = RendererBudget.unackedOf(c)
    c.processed = next
    this.adjust(id, RendererBudget.unackedOf(c) - before)
    return true
  }

  /** Count (or stop counting) a terminal toward the total limit. */
  setCounted(id: string, counted: boolean): void {
    const was = !this.uncounted.has(id)
    if (was === counted) return
    const u = this.unacked(id)
    if (counted) {
      this.uncounted.delete(id)
      this.total += u
    } else {
      this.uncounted.add(id)
      this.total -= u
    }
  }

  remove(id: string): void {
    if (!this.uncounted.has(id)) this.total -= this.unacked(id)
    this.counts.delete(id)
    this.uncounted.delete(id)
  }

  /** Renderer reloaded or crashed: its running totals restart from zero. */
  reset(): void {
    this.counts.clear()
    this.total = 0
  }

  private adjust(id: string, delta: number): void {
    if (!this.uncounted.has(id)) this.total += delta
  }
}
