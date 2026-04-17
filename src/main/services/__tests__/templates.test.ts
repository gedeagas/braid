import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted alongside vi.mock so the factory can reference it without TDZ errors.
const mockExecFile = vi.hoisted(() => vi.fn())
vi.mock('child_process', () => ({ execFile: mockExecFile }))
vi.mock('../../lib/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

type ExecFileCb = (err: Error | null, stdout: string, stderr: string) => void

/** Capture the arguments passed to execFile for a successful run. */
function stubSuccess() {
  mockExecFile.mockImplementation(
    (_bin: string, _args: string[], _opts: object, cb: ExecFileCb) => cb(null, '', '')
  )
}

/** Capture the arguments passed to execFile and fail the call. */
function stubFailure(stderr = 'scaffold failed') {
  mockExecFile.mockImplementation(
    (_bin: string, _args: string[], _opts: object, cb: ExecFileCb) =>
      cb(new Error('non-zero exit'), '', stderr)
  )
}

describe('templatesService.create("nextjs")', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.resetAllMocks()
  })

  it('invokes create-next-app with the expected flags, cwd, and timeout', async () => {
    stubSuccess()
    const { templatesService } = await import('../templates')

    const res = await templatesService.create('nextjs', {
      parentDir: '/tmp/projects',
      projectName: 'my-app',
    })

    expect(res).toEqual({ success: true })
    expect(mockExecFile).toHaveBeenCalledOnce()

    const [bin, args, opts] = mockExecFile.mock.calls[0]
    // Runs inside an interactive login shell so PATH managers (nvm, brew) are available.
    expect(typeof bin).toBe('string')
    expect(args[0]).toBe('-l')
    expect(args[1]).toBe('-c')

    const command = args[2] as string
    expect(command).toContain('npx --yes create-next-app@latest')
    expect(command).toContain('"my-app"')
    expect(command).toContain('--ts')
    expect(command).toContain('--app')
    expect(command).toContain('--tailwind')
    expect(command).toContain('--eslint')
    expect(command).toContain('--src-dir')
    expect(command).toContain('--use-npm')
    expect(command).toContain('--yes')

    expect(opts).toMatchObject({ cwd: '/tmp/projects', timeout: 600_000 })
  })

  it('propagates failure with stderr when create-next-app exits non-zero', async () => {
    stubFailure('EACCES')
    const { templatesService } = await import('../templates')

    const res = await templatesService.create('nextjs', {
      parentDir: '/tmp/projects',
      projectName: 'my-app',
    })

    expect(res.success).toBe(false)
    expect(res.stderr).toBe('EACCES')
  })

  it('rejects invalid project names without spawning a shell', async () => {
    const { templatesService } = await import('../templates')

    const res = await templatesService.create('nextjs', {
      parentDir: '/tmp/projects',
      projectName: '../escape',
    })

    expect(res.success).toBe(false)
    expect(res.stderr).toMatch(/Invalid project name/)
    expect(mockExecFile).not.toHaveBeenCalled()
  })

  it('rejects missing parent directory without spawning a shell', async () => {
    const { templatesService } = await import('../templates')

    const res = await templatesService.create('nextjs', {
      parentDir: '',
      projectName: 'my-app',
    })

    expect(res.success).toBe(false)
    expect(res.stderr).toMatch(/Parent directory/i)
    expect(mockExecFile).not.toHaveBeenCalled()
  })
})
