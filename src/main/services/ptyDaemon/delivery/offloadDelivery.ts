// Output delivery for a daemon that keeps each session's screen in a headless
// terminal (features headless-snapshot + status-events). Hidden terminals get
// no output at all: the daemon has their screen, and agent status comes from
// the daemon too. When one is shown again the renderer asks for a snapshot:
//
//   1. renderer: setVisible(id, true), then requests the snapshot
//   2. main: beginHold(id) - live output is queued, not sent
//   3. renderer: term.reset(), writes the snapshot, confirms with its seq
//   4. main: endHold(id, seq) - drops queued output the snapshot covers, sends the rest
//
// A terminal stays stale if it missed more output after the hold began (hidden
// again meanwhile) or the snapshot failed (releaseHold), so the next show
// snapshots again.
//
// Query replies: the daemon answers the output numbered up to its show point
// (the reply to setVisible), so output main delivers from the show until that
// reply, and up to the point after it, goes out marked no-reply. On hide, main
// reports the last seq it delivered: the renderer answered those.
//
// A terminal is delivered while visible, or while the renderer said it still
// needs its output (delivery interest, e.g. to type an initial command).
// With an older daemon (legacy mode) none of this applies.

import { OutputDelivery, DEFAULT_DELIVERY_CONFIG, type DeliveryConfig, type DeliverySink } from './outputDelivery'

/** A snapshot the renderer never confirmed stops holding output after this. */
export const SNAPSHOT_HOLD_TIMEOUT_MS = 5_000

/** What the daemon needs to hear when delivery of a terminal starts or stops. */
export type DeliveringInfo =
  /** Started: pass `token` back with the daemon's show point (setShowPoint). */
  | { snapshotFollows: boolean; token: number }
  /** Stopped: the last seq delivered, when any was. */
  | { deliveredThrough?: number }

export class OffloadingDelivery extends OutputDelivery {
  private offload = false
  private interest = new Set<string>()
  private held = new Map<string, { timer: ReturnType<typeof setTimeout>; staleGen: number }>()
  /** Terminals whose renderer xterm missed output (needs a snapshot to be current). */
  private stale = new Set<string>()
  /** Bumped whenever a terminal misses output, so a snapshot only clears what it covers. */
  private staleGen = new Map<string, number>()
  /** Output numbered up to `through` is the daemon's to answer (Infinity until it replies). */
  private showPoints = new Map<string, { through: number; token: number }>()
  private showTokens = 0

  constructor(
    sink: DeliverySink,
    config: DeliveryConfig = DEFAULT_DELIVERY_CONFIG,
    /** Delivery to the renderer started/stopped (tell the daemon who answers queries). */
    private onDeliveringChange?: (id: string, delivering: boolean, info: DeliveringInfo) => void,
  ) {
    super(sink, config)
  }

  /** Turn offloading on for a capable daemon, off for an older one. */
  setOffload(enabled: boolean): void {
    if (this.offload === enabled) return
    const ids = new Set([...this.queues.keys(), ...this.hidden, ...this.interest])
    const before = new Map([...ids].map((id) => [id, this.isDelivering(id)]))
    this.offload = enabled
    if (!enabled) {
      for (const hold of this.held.values()) clearTimeout(hold.timer)
      this.held.clear()
      this.stale.clear()
      this.showPoints.clear()
    }
    for (const id of ids) this.afterChange(id, before.get(id) ?? true)
  }

  isOffloading(): boolean {
    return this.offload
  }

  isDelivering(id: string): boolean {
    return !this.offload || this.isVisible(id) || this.interest.has(id)
  }

  override setVisible(id: string, visible: boolean): void {
    const before = this.isDelivering(id)
    super.setVisible(id, visible)
    this.afterChange(id, before)
  }

  /** Keep delivering a hidden terminal while the renderer needs its output. */
  setInterest(id: string, interested: boolean): void {
    const before = this.isDelivering(id)
    if (interested) this.interest.add(id)
    else this.interest.delete(id)
    this.afterChange(id, before)
  }

  override push(id: string, data: string, seq = 0): void {
    if (!this.isDelivering(id)) {
      if (data) this.setStale(id)
      return
    }
    super.push(id, data, seq)
  }

  isStale(id: string): boolean {
    return this.stale.has(id)
  }

  /** The renderer's xterm for `id` is new or out of date (reattach, reload). */
  markStale(id: string): void {
    if (this.offload) this.setStale(id)
  }

  /** The daemon's reply to the show that handed out `token`: it answers output through `seq`. */
  setShowPoint(id: string, seq: number, token: number): void {
    const point = this.showPoints.get(id)
    if (!point || point.token !== token) return
    point.through = seq
    if (this.queued(id) > 0) this.schedule(this.config.followUpMs)
  }

  /** Info for telling a (re)connected daemon about `id` again; a new show point when delivering. */
  restartShow(id: string): DeliveringInfo {
    if (!this.isDelivering(id)) return {}
    const token = ++this.showTokens
    this.showPoints.set(id, { through: Infinity, token })
    return { snapshotFollows: this.stale.has(id), token }
  }

  /** The show reply failed: stop marking output (a duplicate reply beats none forever). */
  clearShowPoint(id: string): void {
    this.showPoints.delete(id)
    if (this.queued(id) > 0) this.schedule(this.config.followUpMs)
  }

  /** Step 2: queue live output until the renderer applied a snapshot. */
  beginHold(id: string): void {
    this.clearHold(id)
    this.held.set(id, {
      timer: setTimeout(() => this.abandonHold(id), SNAPSHOT_HOLD_TIMEOUT_MS),
      staleGen: this.staleGen.get(id) ?? 0,
    })
  }

  /** Step 4: the snapshot covered output up to `seq`. */
  endHold(id: string, seq: number): void {
    const hold = this.clearHold(id)
    this.queues.get(id)?.dropThrough(seq)
    // Output missed after the hold began is not in the snapshot.
    if (hold && hold.staleGen === (this.staleGen.get(id) ?? 0)) this.stale.delete(id)
    this.afterDrop(id)
  }

  /** Stop holding without a snapshot (not needed, or it failed): staleness is unchanged. */
  releaseHold(id: string): void {
    this.clearHold(id)
    this.afterDrop(id)
  }

  override remove(id: string): void {
    this.clearHold(id)
    this.showPoints.delete(id)
    this.interest.delete(id)
    this.stale.delete(id)
    this.staleGen.delete(id)
    super.remove(id)
  }

  override reset(): void {
    for (const hold of this.held.values()) clearTimeout(hold.timer)
    this.held.clear()
    this.interest.clear()
    this.showPoints.clear()
    super.reset()
  }

  override dispose(): void {
    for (const hold of this.held.values()) clearTimeout(hold.timer)
    this.held.clear()
    super.dispose()
  }

  protected override noReplyThrough(id: string): number {
    return this.showPoints.get(id)?.through ?? -Infinity
  }

  protected override canDeliver(id: string): boolean {
    return super.canDeliver(id) && this.isDelivering(id) && !this.held.has(id)
  }

  /** No confirmation came: drop what was held; the next show re-snapshots. */
  private abandonHold(id: string): void {
    this.held.delete(id)
    this.queues.get(id)?.clear()
    this.setStale(id)
    this.queueChanged(id)
  }

  private clearHold(id: string): { staleGen: number } | undefined {
    const hold = this.held.get(id)
    if (hold) clearTimeout(hold.timer)
    this.held.delete(id)
    return hold
  }

  /** After a hold ends: resume a producer paused for the dropped output, send the rest. */
  private afterDrop(id: string): void {
    this.queueChanged(id)
    if (this.queued(id) > 0) this.schedule(this.config.followUpMs)
  }

  private setStale(id: string): void {
    this.stale.add(id)
    this.staleGen.set(id, (this.staleGen.get(id) ?? 0) + 1)
  }

  private afterChange(id: string, before: boolean): void {
    const after = this.isDelivering(id)
    if (before === after) return
    this.budget.setCounted(id, after)
    let info: DeliveringInfo
    if (!after) {
      const q = this.queues.get(id)
      info = q && q.deliveredSeq > 0 ? { deliveredThrough: q.deliveredSeq } : {}
      if (q && q.length > 0) this.setStale(id)
      q?.clear()
      this.queueChanged(id)
      this.showPoints.delete(id)
    } else {
      const token = ++this.showTokens
      if (this.offload) this.showPoints.set(id, { through: Infinity, token })
      info = { snapshotFollows: this.stale.has(id), token }
      if (this.queued(id) > 0) this.schedule(this.config.flushMs)
    }
    if (this.offload) this.onDeliveringChange?.(id, after, info)
  }
}
