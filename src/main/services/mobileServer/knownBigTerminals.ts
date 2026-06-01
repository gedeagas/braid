/**
 * The big terminals the desktop currently tracks in its persisted tab lists
 * (across ALL worktrees), keyed by terminalId. The renderer is authoritative for
 * both "what should exist" AND the display label (which lives in renderer state,
 * not always in the daemon's metadata), so it pushes the full set on startup and
 * whenever a tab is created/closed/renamed.
 *
 * `terminal.list` reads the daemon's full session list (so terminals in worktrees
 * the desktop hasn't reopened still appear), intersects it with this set to drop
 * orphans, and takes the label from here - which is why a terminal shows its real
 * name even when the daemon's own metadata label is missing.
 */
export interface KnownBigTerminal {
  terminalId: string
  label?: string
  agentId?: string
  worktreeId?: string
}

let knownById = new Map<string, KnownBigTerminal>()
let received = false

export function setKnownBigTerminals(items: KnownBigTerminal[]): void {
  knownById = new Map(items.filter((it) => it && it.terminalId).map((it) => [it.terminalId, it]))
  received = true
}

export function getKnownBigTerminals(): Map<string, KnownBigTerminal> {
  return knownById
}

/** Whether the renderer has pushed its set yet. Until it has, `terminal.list`
 *  falls back to the in-process instance map so it can't show stale orphans. */
export function hasKnownBigTerminals(): boolean {
  return received
}
