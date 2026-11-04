// OSC 8 hyperlinks after a screen snapshot. serialize() drops them, so the
// daemon sends their ranges next to the snapshot; here each one is pinned to
// its row with a marker (rows move as scrollback is trimmed) and served by a
// link provider. A later snapshot replaces them.

import { modifierFromEvent, openLink } from '@/lib/browser/linkRouter'
import { resolveSafeExternalUrl } from '@/lib/safeExternalUrl'

export interface SnapshotLink {
  row: number
  startCol: number
  endCol: number
  uri: string
}

interface Marker { line: number; isDisposed: boolean; dispose(): void }
interface ProvidedLink {
  range: { start: { x: number; y: number }; end: { x: number; y: number } }
  text: string
  activate(event: unknown, text: string): void
}

/** What this module needs from an xterm Terminal. */
export interface LinkTerminal {
  buffer: { active: { baseY: number; cursorY: number } }
  registerMarker(cursorYOffset?: number): Marker | undefined
  registerLinkProvider(provider: { provideLinks(y: number, cb: (links: ProvidedLink[] | undefined) => void): void }): { dispose(): void }
}

interface Restored { link: SnapshotLink; marker: Marker }

const byTerminal = new WeakMap<LinkTerminal, { entries: Restored[]; provider: { dispose(): void } }>()

type ClickEvent = Parameters<typeof modifierFromEvent>[0]

/**
 * Open an OSC 8 link the way the terminal's plain URLs open (the link router:
 * Braid's browser or the system one), http(s) only.
 */
export function openTerminalLink(uri: string, event?: ClickEvent): void {
  const safe = resolveSafeExternalUrl(uri)
  if (safe) openLink(safe, { modifier: modifierFromEvent(event) })
}

export function restoreSnapshotLinks(
  term: LinkTerminal,
  links: readonly SnapshotLink[] | undefined,
  open: (uri: string, event?: ClickEvent) => void = openTerminalLink,
): void {
  let state = byTerminal.get(term)
  for (const e of state?.entries ?? []) e.marker.dispose()
  if (state) state.entries = []
  if (!links || links.length === 0) return

  const { baseY, cursorY } = term.buffer.active
  const cursorRow = baseY + cursorY
  const entries: Restored[] = []
  for (const link of links) {
    const marker = term.registerMarker(link.row - cursorRow)
    if (marker) entries.push({ link, marker })
  }
  if (!state) {
    const s: { entries: Restored[]; provider: { dispose(): void } } = { entries, provider: { dispose() {} } }
    s.provider = term.registerLinkProvider({
      provideLinks(y, cb) {
        const row = y - 1
        cb(s.entries
          .filter((e) => !e.marker.isDisposed && e.marker.line === row)
          .map((e) => ({
            range: { start: { x: e.link.startCol + 1, y }, end: { x: e.link.endCol, y } },
            text: e.link.uri,
            activate: (event) => open(e.link.uri, event as ClickEvent),
          })))
      },
    })
    state = s
    byTerminal.set(term, state)
  }
  state.entries = entries
}
