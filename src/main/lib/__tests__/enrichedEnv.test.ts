import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted alongside vi.mock so the factory can reference it without TDZ errors.
const mockExecFile = vi.hoisted(() => vi.fn())
vi.mock('child_process', () => ({ execFile: mockExecFile }))

describe('enrichedEnv', () => {
  // Reset the module registry before each test so each fresh `import()` triggers
  // a new module load — and therefore a new probe() invocation — with the
  // mockImplementation set in that test.
  beforeEach(() => {
    vi.resetModules()
    vi.resetAllMocks()
  })

  it('uses login-shell PATH when probe succeeds', async () => {
    mockExecFile.mockImplementation(
      (_bin: string, _args: string[], _opts: object, cb: (err: null, stdout: string) => void) => {
        cb(null, '/custom/bin:/usr/local/bin\n')
      },
    )

    const mod = await import('../enrichedEnv')
    await mod.waitForEnrichedEnv()

    expect(mod.enrichedEnv().PATH).toBe('/custom/bin:/usr/local/bin')
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

  it('falls back when probe stdout is only whitespace', async () => {
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

  it('waitForEnrichedEnv returns the same promise on repeated calls (probe runs once)', async () => {
    mockExecFile.mockImplementation(
      (_bin: string, _args: string[], _opts: object, cb: (err: null, stdout: string) => void) => {
        cb(null, '/probed\n')
      },
    )

    const mod = await import('../enrichedEnv')

    const p1 = mod.waitForEnrichedEnv()
    const p2 = mod.waitForEnrichedEnv()
    expect(p1).toBe(p2)

    await p1
    expect(mockExecFile).toHaveBeenCalledOnce()
  })

  it('enrichedEnv spreads all process.env entries alongside the probed PATH', async () => {
    mockExecFile.mockImplementation(
      (_bin: string, _args: string[], _opts: object, cb: (err: null, stdout: string) => void) => {
        cb(null, '/probed/bin\n')
      },
    )

    const mod = await import('../enrichedEnv')
    await mod.waitForEnrichedEnv()

    const env = mod.enrichedEnv()
    expect(env.PATH).toBe('/probed/bin')
    // Spot-check a well-known env var that's always set in the test runner
    if (process.env.HOME) {
      expect(env.HOME).toBe(process.env.HOME)
    }
  })
})
