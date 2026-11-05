import { describe, it, expect, vi, beforeEach } from 'vitest'

const router = vi.hoisted(() => ({
  openLink: vi.fn(),
  modifierFromEvent: vi.fn((e: { metaKey?: boolean } | undefined) => ({ shift: false, platformMod: Boolean(e?.metaKey) })),
}))
vi.mock('@/lib/browser/linkRouter', () => router)

import { openTerminalLink, restoreSnapshotLinks, type LinkTerminal } from '../ptyOutput/restoredLinks'

interface Provided { range: { start: { x: number; y: number }; end: { x: number; y: number } }; text: string; activate(e: unknown, text: string): void }

function fakeTerm(baseY: number, cursorY: number, lines: Map<number, string> = new Map()) {
  const markers: Array<{ line: number; isDisposed: boolean; dispose(): void }> = []
  let provider: { provideLinks(y: number, cb: (links: Provided[] | undefined) => void): void } | null = null
  const term: LinkTerminal & { scroll(n: number): void; linksAt(y: number): Provided[] } = {
    buffer: {
      active: {
        baseY, cursorY,
        getLine: (row: number) => {
          const text = lines.get(row)
          return text === undefined ? undefined : { translateToString: (_t?: boolean, s = 0, e = text.length) => text.slice(s, e) }
        },
      },
    },
    registerMarker: (offset: number) => {
      const m = { line: baseY + cursorY + offset, isDisposed: false, dispose() { m.isDisposed = true } }
      markers.push(m)
      return m
    },
    registerLinkProvider: (p) => { provider = p as typeof provider; return { dispose: () => { provider = null } } },
    scroll: (n) => { for (const m of markers) m.line -= n }, // scrollback trimmed n lines
    linksAt: (y) => { let out: Provided[] = []; provider?.provideLinks(y, (l) => { out = l ?? [] }); return out },
  }
  return term
}

describe('restoreSnapshotLinks (OSC 8 hyperlinks after a snapshot)', () => {
  it('serves each link on its row, and opens it', () => {
    const term = fakeTerm(100, 5)
    const open = vi.fn()
    restoreSnapshotLinks(term, [{ row: 3, startCol: 4, endCol: 8, uri: 'https://example.com/a' }], open)
    const links = term.linksAt(4) // provider rows are 1-based
    expect(links).toHaveLength(1)
    expect(links[0].range).toEqual({ start: { x: 5, y: 4 }, end: { x: 8, y: 4 } })
    const click = { metaKey: true }
    links[0].activate(click, links[0].text)
    expect(open).toHaveBeenCalledWith('https://example.com/a', click)
    expect(term.linksAt(5)).toEqual([])
  })

  it('follows its row when scrollback is trimmed', () => {
    const term = fakeTerm(100, 5)
    restoreSnapshotLinks(term, [{ row: 50, startCol: 0, endCol: 3, uri: 'https://x.test' }], vi.fn())
    term.scroll(10)
    expect(term.linksAt(41)).toHaveLength(1)
  })

  it('stops serving a link once its text is overwritten', () => {
    const lines = new Map([[3, 'see docs here']])
    const term = fakeTerm(0, 5, lines)
    restoreSnapshotLinks(term, [{ row: 3, startCol: 4, endCol: 8, uri: 'https://example.com/a' }], vi.fn())
    expect(term.linksAt(4)).toHaveLength(1)
    lines.set(3, '$ ls -la')
    expect(term.linksAt(4)).toEqual([])
  })

  it('replaces the links of an earlier snapshot', () => {
    const term = fakeTerm(0, 0)
    restoreSnapshotLinks(term, [{ row: 0, startCol: 0, endCol: 3, uri: 'https://old.test' }], vi.fn())
    restoreSnapshotLinks(term, [{ row: 1, startCol: 0, endCol: 3, uri: 'https://new.test' }], vi.fn())
    expect(term.linksAt(1)).toEqual([])
    expect(term.linksAt(2)[0].text).toBe('https://new.test')
  })
})

describe('openTerminalLink (OSC 8 links, live and restored)', () => {
  beforeEach(() => router.openLink.mockClear())

  it('opens through the link router, like plain URLs, keeping the click modifier', () => {
    openTerminalLink('https://example.com/a', { metaKey: true })
    expect(router.openLink).toHaveBeenCalledWith('https://example.com/a', { modifier: { shift: false, platformMod: true } })
  })

  it('opens restored links through the router by default', () => {
    const term = fakeTerm(0, 0)
    restoreSnapshotLinks(term, [{ row: 0, startCol: 0, endCol: 3, uri: 'https://r.test' }])
    term.linksAt(1)[0].activate({}, 'https://r.test')
    expect(router.openLink).toHaveBeenCalledWith('https://r.test/', expect.anything())
  })

  it('ignores anything but http(s)', () => {
    openTerminalLink('file:///etc/passwd', {})
    openTerminalLink('javascript:alert(1)', {})
    expect(router.openLink).not.toHaveBeenCalled()
  })
})
