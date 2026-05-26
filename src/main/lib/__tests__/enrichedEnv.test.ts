import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Hoisted alongside vi.mock so the factory can reference it without TDZ errors.
const mockExecFile = vi.hoisted(() => vi.fn())
vi.mock('child_process', () => ({ execFile: mockExecFile }))

const DELIM_START = '__BRAID_PATH_START__'
const DELIM_END = '__BRAID_PATH_END__'

describe('enrichedEnv', () => {
  let savedPath: string | undefined

  // Reset the module registry before each test so each fresh `import()` triggers
  // a new module load - and therefore a new probe() invocation - with the
  // mockImplementation set in that test.
  beforeEach(() => {
    vi.resetModules()
    vi.resetAllMocks()
    savedPath = process.env.PATH
  })

  afterEach(() => {
    // Restore PATH since probe now mutates process.env.PATH
    if (savedPath === undefined) delete process.env.PATH
    else process.env.PATH = savedPath
  })

  it('uses login-shell PATH when probe succeeds with delimiters', async () => {
    mockExecFile.mockImplementation(
      (_bin: string, _args: string[], _opts: object, cb: (err: null, stdout: string) => void) => {
        cb(null, `${DELIM_START}/custom/bin:/usr/local/bin${DELIM_END}\n`)
      },
    )

    const mod = await import('../enrichedEnv')
    await mod.waitForEnrichedEnv()

    // The probed PATH segments should be merged into process.env.PATH
    const pathVal = mod.enrichedEnv().PATH!
    expect(pathVal).toContain('/custom/bin')
    expect(pathVal).toContain('/usr/local/bin')
  })

  it('falls back to Homebrew PATH when probe errors', async () => {
    mockExecFile.mockImplementation(
      (_bin: string, _args: string[], _opts: object, cb: (err: Error, stdout: string) => void) => {
        cb(new Error('spawn ENOENT'), '')
      },
    )

    const mod = await import('../enrichedEnv')
    await mod.waitForEnrichedEnv()

    const pathVal = mod.enrichedEnv().PATH!
    expect(pathVal).toContain('/opt/homebrew/bin')
    expect(pathVal).toContain('/usr/local/bin')
  })

  it('falls back when probe stdout has no delimiters and no valid path', async () => {
    mockExecFile.mockImplementation(
      (_bin: string, _args: string[], _opts: object, cb: (err: null, stdout: string) => void) => {
        cb(null, '   \n  ')
      },
    )

    const mod = await import('../enrichedEnv')
    await mod.waitForEnrichedEnv()

    const pathVal = mod.enrichedEnv().PATH!
    expect(pathVal).toContain('/opt/homebrew/bin')
  })

  it('falls back to last-line heuristic when delimiters are missing', async () => {
    mockExecFile.mockImplementation(
      (_bin: string, _args: string[], _opts: object, cb: (err: null, stdout: string) => void) => {
        cb(null, 'Welcome to zsh!\n/fallback/bin:/usr/bin\n')
      },
    )

    const mod = await import('../enrichedEnv')
    await mod.waitForEnrichedEnv()

    const pathVal = mod.enrichedEnv().PATH!
    expect(pathVal).toContain('/fallback/bin')
  })

  it('strips ANSI escape codes from output', async () => {
    mockExecFile.mockImplementation(
      (_bin: string, _args: string[], _opts: object, cb: (err: null, stdout: string) => void) => {
        cb(null, `\x1b[32m${DELIM_START}/ansi/bin:/usr/bin${DELIM_END}\x1b[0m\n`)
      },
    )

    const mod = await import('../enrichedEnv')
    await mod.waitForEnrichedEnv()

    const pathVal = mod.enrichedEnv().PATH!
    expect(pathVal).toContain('/ansi/bin')
  })

  it('waitForEnrichedEnv returns the same promise on repeated calls (probe runs once)', async () => {
    mockExecFile.mockImplementation(
      (_bin: string, _args: string[], _opts: object, cb: (err: null, stdout: string) => void) => {
        cb(null, `${DELIM_START}/probed${DELIM_END}\n`)
      },
    )

    const mod = await import('../enrichedEnv')

    const p1 = mod.waitForEnrichedEnv()
    const p2 = mod.waitForEnrichedEnv()
    expect(p1).toBe(p2)

    await p1
    expect(mockExecFile).toHaveBeenCalledOnce()
  })

  it('enrichedEnv returns process.env with the hydrated PATH', async () => {
    mockExecFile.mockImplementation(
      (_bin: string, _args: string[], _opts: object, cb: (err: null, stdout: string) => void) => {
        cb(null, `${DELIM_START}/probed/bin${DELIM_END}\n`)
      },
    )

    const mod = await import('../enrichedEnv')
    await mod.waitForEnrichedEnv()

    const env = mod.enrichedEnv()
    expect(env.PATH).toContain('/probed/bin')
    // enrichedEnv() returns process.env directly (PATH mutated in-place)
    expect(env).toBe(process.env)
  })

  it('deduplicates PATH segments during merge', async () => {
    // Set up a known PATH
    process.env.PATH = '/usr/bin:/existing/bin'

    mockExecFile.mockImplementation(
      (_bin: string, _args: string[], _opts: object, cb: (err: null, stdout: string) => void) => {
        cb(null, `${DELIM_START}/new/bin:/usr/bin:/existing/bin${DELIM_END}\n`)
      },
    )

    const mod = await import('../enrichedEnv')
    await mod.waitForEnrichedEnv()

    const pathVal = mod.enrichedEnv().PATH!
    // /usr/bin and /existing/bin should appear once, /new/bin prepended
    const segments = pathVal.split(':')
    const usrBinCount = segments.filter((s) => s === '/usr/bin').length
    expect(usrBinCount).toBe(1)
    expect(pathVal).toContain('/new/bin')
  })
})
