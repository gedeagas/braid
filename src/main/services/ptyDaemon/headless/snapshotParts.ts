// Parts of a screen snapshot that SerializeAddon does not produce, read from
// xterm's own buffer state (private fields, checked before use):
//  - the cursor, restored with an absolute position, plus the saved cursor
//    (DECSC) register, the scroll region and origin mode;
//  - OSC 8 hyperlink ranges, which serialize() drops.

import type { Terminal } from '@xterm/headless'
import type { SnapshotLinkRange } from '../protocol'

interface CoreBuffer {
  savedX?: number
  savedY?: number
  savedOriginMode?: boolean
  ybase?: number
  scrollTop?: number
  scrollBottom?: number
}

interface CoreTerminal {
  _core?: {
    buffer?: CoreBuffer
    _oscLinkService?: { getLinkData(id: number): { uri?: string } | undefined; _dataByLinkId?: { size?: number } }
  }
}

const core = (term: Terminal) => (term as unknown as CoreTerminal)._core

export interface SavedCursor { x: number; y: number; originMode: boolean }

/** The active buffer's DECSC register (viewport-relative), or null when never set. */
export function readSavedCursor(term: Terminal): SavedCursor | null {
  const b = core(term)?.buffer
  if (typeof b?.savedX !== 'number' || typeof b.savedY !== 'number' || typeof b.ybase !== 'number') return null
  // Like DECRC: clamp to the viewport; CUP cannot express a wrap-pending x == cols.
  const y = Math.min(Math.max(b.savedY - b.ybase, 0), term.rows - 1)
  const x = Math.min(Math.max(b.savedX, 0), term.cols - 1)
  const originMode = b.savedOriginMode === true
  // Home is the never-saved default; don't overwrite a fresh register with it.
  if (x === 0 && y === 0 && !originMode) return null
  return { x, y, originMode }
}

/**
 * Cursor state to append after the serialized content: saved cursor (saved
 * against a full region so old margins can't move it), scroll region, origin
 * mode, then the absolute cursor. A wrap-pending cursor (x == cols) gets no
 * CUP: CUP would clamp it and the next character would overwrite the last
 * column instead of wrapping; the serialized content already left it there.
 */
export function cursorRestoreSequence(term: Terminal): string {
  const { cursorX, cursorY } = term.buffer.active
  const b = core(term)?.buffer
  const scrollTop = b?.scrollTop ?? 0
  const scrollBottom = b?.scrollBottom ?? term.rows - 1
  const originMode = term.modes.originMode
  const saved = readSavedCursor(term)
  const cupY = cursorY - (originMode ? scrollTop : 0)
  const canPlace = cursorX >= 0 && cursorX < term.cols && cupY >= 0 && cupY < term.rows
  const hasRegion = scrollTop !== 0 || scrollBottom !== term.rows - 1
  let s = ''
  if (saved) s += `\x1b[r\x1b[?6${saved.originMode ? 'h' : 'l'}\x1b[${saved.y + 1};${saved.x + 1}H\x1b7`
  if (hasRegion && (canPlace || saved)) s += `\x1b[${scrollTop + 1};${scrollBottom + 1}r`
  if (saved || originMode) s += `\x1b[?6${originMode ? 'h' : 'l'}`
  if (canPlace) s += `\x1b[${cupY + 1};${cursorX + 1}H`
  return s
}

/** OSC 8 hyperlinks in the active buffer, as absolute buffer rows. */
export function collectLinkRanges(term: Terminal): SnapshotLinkRange[] {
  const service = core(term)?._oscLinkService
  if (!service || service._dataByLinkId?.size === 0) return []
  const buffer = term.buffer.active
  const cell = buffer.getNullCell()
  const ranges: SnapshotLinkRange[] = []
  for (let row = 0; row < buffer.length; row++) {
    const line = buffer.getLine(row)
    if (!line) continue
    const len = Math.min(term.cols, line.length)
    let current = 0
    let start = -1
    for (let col = 0; col <= len; col++) {
      let id = 0
      if (col < len) {
        const c = line.getCell(col, cell) as unknown as { hasExtendedAttrs?(): number; extended?: { urlId?: number } } | undefined
        id = c?.hasExtendedAttrs?.() && c.extended?.urlId ? c.extended.urlId : 0
      }
      if (id === current) continue
      if (current && start >= 0) {
        const uri = service.getLinkData(current)?.uri
        if (uri) ranges.push({ row, startCol: start, endCol: col, uri })
      }
      current = id
      start = id ? col : -1
    }
  }
  return ranges
}
