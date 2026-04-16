import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mocks (must come before module import) ──────────────────────────────────

const mockEnrichedEnv = vi.fn()
vi.mock('../../lib/enrichedEnv', () => ({
  enrichedEnv: () => mockEnrichedEnv(),
}))

const mockExistsSync = vi.fn()
vi.mock('fs', async (importActual) => {
  const actual = await importActual<typeof import('fs')>()
  return { ...actual, existsSync: (p: string) => mockExistsSync(p) }
})

vi.mock('os', async (importActual) => {
  const actual = await importActual<typeof import('os')>()
  return { ...actual, homedir: () => '/home/testuser' }
})

// Import AFTER mocks are in place
import { buildEnrichedPath, findBinary } from '../helpers'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const HOME = '/home/testuser'
const LSP_BIN = `${HOME}/Braid/lsp-servers`

function parsePaths(enriched: string): string[] {
  return enriched.split(':').filter(Boolean)
}

// ─── buildEnrichedPath ───────────────────────────────────────────────────────

describe('buildEnrichedPath', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnrichedEnv.mockReturnValue({ PATH: '/usr/local/bin:/usr/bin:/bin' })
  })

  it('puts lsp-servers dir first (highest priority)', () => {
    const paths = parsePaths(buildEnrichedPath())
    expect(paths[0]).toBe(LSP_BIN)
  })

  it('includes all paths from enrichedEnv().PATH', () => {
    mockEnrichedEnv.mockReturnValue({ PATH: '/custom/bin:/another/bin' })
    const paths = parsePaths(buildEnrichedPath())
    expect(paths).toContain('/custom/bin')
    expect(paths).toContain('/another/bin')
  })

  it('falls back to process.env.PATH when enrichedEnv returns no PATH', () => {
    mockEnrichedEnv.mockReturnValue({})
    vi.stubEnv('PATH', '/fallback/bin')
    const paths = parsePaths(buildEnrichedPath())
    expect(paths).toContain('/fallback/bin')
  })

  it('deduplicates paths that appear in multiple sources', () => {
    mockEnrichedEnv.mockReturnValue({ PATH: `${LSP_BIN}:/usr/bin` })
    const paths = parsePaths(buildEnrichedPath())
    const count = paths.filter(p => p === LSP_BIN).length
    expect(count).toBe(1)
  })

  it('includes nvm/fnm paths if enrichedEnv surfaces them', () => {
    const nvmNode = '/Users/testuser/Library/Application Support/fnm/node-versions/v22.14.0/installation/bin'
    mockEnrichedEnv.mockReturnValue({ PATH: `${nvmNode}:/usr/bin` })
    const paths = parsePaths(buildEnrichedPath())
    expect(paths).toContain(nvmNode)
  })
})

// ─── findBinary ──────────────────────────────────────────────────────────────

describe('findBinary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExistsSync.mockReturnValue(false)
  })

  it('returns the full path when binary exists in one of the PATH dirs', () => {
    mockExistsSync.mockImplementation((p: string) => p === '/opt/homebrew/bin/pnpm')
    const result = findBinary('pnpm', '/usr/bin:/opt/homebrew/bin:/usr/local/bin')
    expect(result).toBe('/opt/homebrew/bin/pnpm')
  })

  it('returns the first match when binary exists in multiple dirs', () => {
    mockExistsSync.mockImplementation((p: string) =>
      p === '/usr/local/bin/node' || p === '/usr/bin/node'
    )
    const result = findBinary('node', '/usr/local/bin:/usr/bin')
    expect(result).toBe('/usr/local/bin/node')
  })

  it('returns null when binary does not exist anywhere in PATH', () => {
    mockExistsSync.mockReturnValue(false)
    const result = findBinary('pnpm', '/usr/bin:/usr/local/bin')
    expect(result).toBeNull()
  })

  it('returns null for an empty enriched PATH', () => {
    const result = findBinary('pnpm', '')
    expect(result).toBeNull()
  })

  it('skips dirs where existsSync throws (e.g. permission errors)', () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p.startsWith('/restricted')) throw new Error('EACCES')
      return p === '/usr/local/bin/tsc'
    })
    const result = findBinary('tsc', '/restricted/bin:/usr/local/bin')
    expect(result).toBe('/usr/local/bin/tsc')
  })
})
