// Who answers the terminal queries (DA1, DSR, OSC 10/11/12) in a live output
// chunk: the daemon's headless terminal, or the renderer that received the
// chunk. Decided by the chunk's seq, so each query is answered exactly once
// however late the daemon parses it.
//
// A renderer owns the seqs of each period it was shown: (from, to].
//  - from: the last seq numbered when it was shown. Main receives older output
//    before the show reply and delivers it marked no-reply. A snapshot raises
//    it to the snapshot's seq: the renderer replaces its screen with the
//    snapshot (written without replying) and never parses older output.
//  - to: the last seq main delivered before it was hidden.
// While a snapshot is pending (a handoff) the open period is the daemon's: the
// renderer will only parse output newer than the snapshot.

export interface Period {
  from: number
  to: number
  handoffs: number
}

export class AnswerRule {
  private periods: Period[] = []

  get periodCount(): number {
    return this.periods.length
  }

  /** Whether the daemon answers the queries in the live chunk numbered `seq`. */
  daemonAnswers(seq: number): boolean {
    for (const p of this.periods) {
      if (p.handoffs === 0 && seq > p.from && seq <= p.to) return false
    }
    return true
  }

  /** A renderer shows the session: it owns output numbered after `seq`. Returns the show point. */
  show(seq: number): number {
    const open = this.open()
    if (open) return open.from
    this.periods.push({ from: seq, to: Infinity, handoffs: 0 })
    return seq
  }

  /** Hidden: main delivered output through `deliveredThrough` (default: nothing since the show). */
  hide(deliveredThrough?: number): void {
    const open = this.open()
    if (!open) return
    // Mid-handoff the renderer replaces everything with the snapshot or drops it.
    const to = open.handoffs > 0 ? open.from : Math.max(open.from, deliveredThrough ?? open.from)
    if (to === open.from) this.periods.pop()
    else open.to = to
  }

  /** A snapshot for the showing renderer is pending. Null while hidden. */
  beginHandoff(): Period | null {
    const open = this.open()
    if (!open) return null
    open.handoffs++
    return open
  }

  /** That snapshot covers output through `seq`: the renderer owns what follows. */
  endHandoff(period: Period, seq: number): void {
    if (period !== this.open() || period.handoffs === 0) return
    period.handoffs--
    period.from = Math.max(period.from, seq)
  }

  /** Forget closed periods the daemon has parsed past. */
  prune(parsedSeq: number): void {
    this.periods = this.periods.filter((p) => p.to > parsedSeq)
  }

  private open(): Period | undefined {
    const last = this.periods[this.periods.length - 1]
    return last && last.to === Infinity ? last : undefined
  }
}
