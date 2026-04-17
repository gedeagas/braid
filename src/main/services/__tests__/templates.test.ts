import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'

// Hoisted alongside vi.mock so the factories can reference them without TDZ errors.
const mockExecFile = vi.hoisted(() => vi.fn())
const mockStat = vi.hoisted(() => vi.fn())

vi.mock('child_process', () => ({ execFile: mockExecFile }))

vi.mock('fs', () => ({
  promises: { stat: mockStat },
}))

vi.mock('../../lib/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../lib/enrichedEnv', () => ({
  enrichedEnv: () => ({ PATH: '/mock/bin', NODE_ENV: 'test' }),
  waitForEnrichedEnv: () => Promise.resolve(),
}))

type ExecOpts = {
  cwd?: string
  timeout?: number
  maxBuffer?: number
  env?: NodeJS.ProcessEnv
  signal?: AbortSignal
}
type ExecFileCb = (
  err: (Error & { code?: string | number; killed?: boolean; signal?: string }) | null,
  stdout: string,
  stderr: string
) => void

function stubStatIsDirectory(isDir = true) {
  mockStat.mockResolvedValue({ isDirectory: () => isDir })
}

function stubStatRejects() {
  mockStat.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
}

/**
 * Returns a ChildProcess-like stub with EventEmitter stdout/stderr so
 * templates.ts can attach .on('data', ...) for log streaming.
 */
function makeFakeChild() {
  const stdout = new EventEmitter()
  const stderr = new EventEmitter()
  return { stdout, stderr } as { stdout: EventEmitter; stderr: EventEmitter }
}

function stubExecSuccess() {
  mockExecFile.mockImplementation(
    (_bin: string, _args: string[], _opts: ExecOpts, cb: ExecFileCb) => {
      cb(null, '', '')
      return makeFakeChild()
    }
  )
}

function stubExecFailure(stderr = 'scaffold failed') {
  mockExecFile.mockImplementation(
    (_bin: string, _args: string[], _opts: ExecOpts, cb: ExecFileCb) => {
      cb(Object.assign(new Error('non-zero exit'), { code: 1 }), '', stderr)
      return makeFakeChild()
    }
  )
}

function stubExecTimeout() {
  mockExecFile.mockImplementation(
    (_bin: string, _args: string[], _opts: ExecOpts, cb: ExecFileCb) => {
      const err = Object.assign(new Error('command timed out'), {
        killed: true,
        signal: 'SIGTERM' as const,
      })
      cb(err, '', '')
      return makeFakeChild()
    }
  )
}

function stubExecToolMissing() {
  mockExecFile.mockImplementation(
    (_bin: string, _args: string[], _opts: ExecOpts, cb: ExecFileCb) => {
      const err = Object.assign(new Error('spawn npx ENOENT'), { code: 'ENOENT' })
      cb(err, '', '')
      return makeFakeChild()
    }
  )
}

function stubExecAborted() {
  mockExecFile.mockImplementation(
    (_bin: string, _args: string[], opts: ExecOpts, cb: ExecFileCb) => {
      // Simulate the child process being killed when the abort signal fires.
      opts.signal?.addEventListener('abort', () => {
        const err = Object.assign(new Error('The operation was aborted'), {
          name: 'AbortError',
          code: 'ABORT_ERR',
        })
        cb(err, '', '')
      })
      return makeFakeChild()
    }
  )
}

/**
 * Streaming-friendly stub: returns a child with stdout/stderr emitters and
 * gives the caller control over when the callback fires. Used to verify that
 * onLog receives line-split events from stdout/stderr before completion.
 */
function stubExecStreaming() {
  const emitters: { stdout: EventEmitter; stderr: EventEmitter } = {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
  }
  let finish: ((err?: Error) => void) | null = null
  mockExecFile.mockImplementation(
    (_bin: string, _args: string[], _opts: ExecOpts, cb: ExecFileCb) => {
      finish = (err) => {
        if (err) cb(err as Error & { code?: string }, '', '')
        else cb(null, '', '')
      }
      return emitters
    }
  )
  return {
    stdout: emitters.stdout,
    stderr: emitters.stderr,
    finish: (err?: Error) => finish?.(err),
  }
}

describe('templatesService.create("nextjs")', () => {
  beforeEach(() => {
    vi.resetModules()
    mockExecFile.mockReset()
    mockStat.mockReset()
    stubStatIsDirectory(true)
  })

  it('invokes npx via argv (no shell composition) with the expected flags, cwd, timeout, and enriched PATH', async () => {
    stubExecSuccess()
    const {
      templatesService,
      CREATE_NEXT_APP_BIN,
      CREATE_NEXT_APP_BASE_ARGS,
      CREATE_NEXT_APP_FLAGS,
      CREATE_NEXT_APP_TIMEOUT_MS,
    } = await import('../templates')

    const res = await templatesService.create('nextjs', {
      parentDir: '/tmp/projects',
      projectName: 'my-app',
    })

    expect(res).toEqual({ success: true })
    expect(mockStat).toHaveBeenCalledWith('/tmp/projects')
    expect(mockExecFile).toHaveBeenCalledOnce()

    const [bin, args, opts] = mockExecFile.mock.calls[0]
    // Direct argv — the binary is `npx`, not a shell.
    expect(bin).toBe(CREATE_NEXT_APP_BIN)
    expect(bin).toBe('npx')

    // Argv must contain the project name between base args and flags.
    const expectedArgs = [...CREATE_NEXT_APP_BASE_ARGS, 'my-app', ...CREATE_NEXT_APP_FLAGS]
    expect(args).toEqual(expectedArgs)

    // Options include enriched env, timeout constant, cwd, and an AbortSignal.
    expect(opts).toMatchObject({
      cwd: '/tmp/projects',
      timeout: CREATE_NEXT_APP_TIMEOUT_MS,
    })
    expect(opts.env?.PATH).toBe('/mock/bin')
    expect(opts.signal).toBeInstanceOf(AbortSignal)
  })

  it('classifies non-zero exit as reason="failed" and preserves stderr', async () => {
    stubExecFailure('install step failed')
    const { templatesService } = await import('../templates')

    const res = await templatesService.create('nextjs', {
      parentDir: '/tmp/projects',
      projectName: 'my-app',
    })

    expect(res.success).toBe(false)
    if (!res.success) {
      expect(res.reason).toBe('failed')
      expect(res.stderr).toBe('install step failed')
    }
  })

  it('classifies timeout (killed + SIGTERM) as reason="timeout"', async () => {
    stubExecTimeout()
    const { templatesService } = await import('../templates')

    const res = await templatesService.create('nextjs', {
      parentDir: '/tmp/projects',
      projectName: 'my-app',
    })

    expect(res.success).toBe(false)
    if (!res.success) expect(res.reason).toBe('timeout')
  })

  it('classifies ENOENT (npx missing) as reason="tool-missing"', async () => {
    stubExecToolMissing()
    const { templatesService } = await import('../templates')

    const res = await templatesService.create('nextjs', {
      parentDir: '/tmp/projects',
      projectName: 'my-app',
    })

    expect(res.success).toBe(false)
    if (!res.success) expect(res.reason).toBe('tool-missing')
  })

  it('cancel() aborts the in-flight scaffold and surfaces reason="cancelled"', async () => {
    stubExecAborted()
    const { templatesService } = await import('../templates')

    const pending = templatesService.create('nextjs', {
      parentDir: '/tmp/projects',
      projectName: 'my-app',
    })

    // Let the async chain (fs.stat + waitForEnrichedEnv + Promise construction) run before cancelling.
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    const cancelled = templatesService.cancel()
    expect(cancelled).toBe(true)

    const res = await pending
    expect(res.success).toBe(false)
    if (!res.success) expect(res.reason).toBe('cancelled')
  })

  it('cancel() returns false when nothing is in-flight', async () => {
    const { templatesService } = await import('../templates')
    expect(templatesService.cancel()).toBe(false)
  })

  it('rejects invalid project names with reason="invalid-name" without spawning', async () => {
    const { templatesService } = await import('../templates')

    const res = await templatesService.create('nextjs', {
      parentDir: '/tmp/projects',
      projectName: '../escape',
    })

    expect(res.success).toBe(false)
    if (!res.success) expect(res.reason).toBe('invalid-name')
    expect(mockExecFile).not.toHaveBeenCalled()
  })

  it('rejects missing parentDir with reason="missing-parent" without spawning', async () => {
    const { templatesService } = await import('../templates')

    const res = await templatesService.create('nextjs', {
      parentDir: '',
      projectName: 'my-app',
    })

    expect(res.success).toBe(false)
    if (!res.success) expect(res.reason).toBe('missing-parent')
    expect(mockExecFile).not.toHaveBeenCalled()
  })

  it('rejects parentDir that does not exist with reason="parent-not-directory" without spawning', async () => {
    stubStatRejects()
    const { templatesService } = await import('../templates')

    const res = await templatesService.create('nextjs', {
      parentDir: '/does/not/exist',
      projectName: 'my-app',
    })

    expect(res.success).toBe(false)
    if (!res.success) expect(res.reason).toBe('parent-not-directory')
    expect(mockExecFile).not.toHaveBeenCalled()
  })

  it('rejects parentDir that is a file (not a directory) with reason="parent-not-directory"', async () => {
    stubStatIsDirectory(false)
    const { templatesService } = await import('../templates')

    const res = await templatesService.create('nextjs', {
      parentDir: '/tmp/not-a-dir.txt',
      projectName: 'my-app',
    })

    expect(res.success).toBe(false)
    if (!res.success) expect(res.reason).toBe('parent-not-directory')
    expect(mockExecFile).not.toHaveBeenCalled()
  })
})

describe('templatesService streaming progress', () => {
  beforeEach(() => {
    vi.resetModules()
    mockExecFile.mockReset()
    mockStat.mockReset()
    stubStatIsDirectory(true)
  })

  it('forwards stdout/stderr lines to onLog as line-split entries', async () => {
    const h = stubExecStreaming()
    const { templatesService } = await import('../templates')

    const onLog = vi.fn()
    const pending = templatesService.create(
      'nextjs',
      { parentDir: '/tmp/projects', projectName: 'my-app' },
      { onLog }
    )

    // Let fs.stat + waitForEnrichedEnv settle so runNpx has attached listeners.
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    // Emit two stdout lines (second one arrives in two chunks split on the newline).
    h.stdout.emit('data', Buffer.from('Creating a new Next.js app in /tmp/projects/my-app.\n'))
    h.stdout.emit('data', Buffer.from('Installing dependencies:'))
    h.stdout.emit('data', Buffer.from('\r\n'))
    h.stderr.emit('data', Buffer.from('npm warn deprecated\n'))

    h.finish()
    const res = await pending
    expect(res).toEqual({ success: true })

    expect(onLog).toHaveBeenCalledTimes(3)
    expect(onLog).toHaveBeenNthCalledWith(1, {
      stream: 'stdout',
      line: 'Creating a new Next.js app in /tmp/projects/my-app.',
    })
    expect(onLog).toHaveBeenNthCalledWith(2, {
      stream: 'stdout',
      line: 'Installing dependencies:',
    })
    expect(onLog).toHaveBeenNthCalledWith(3, {
      stream: 'stderr',
      line: 'npm warn deprecated',
    })
  })

  it('suppresses blank/whitespace-only lines', async () => {
    const h = stubExecStreaming()
    const { templatesService } = await import('../templates')

    const onLog = vi.fn()
    const pending = templatesService.create(
      'nextjs',
      { parentDir: '/tmp/projects', projectName: 'my-app' },
      { onLog }
    )
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    h.stdout.emit('data', Buffer.from('\n\n   \nreal line\n\n'))
    h.finish()
    await pending

    expect(onLog).toHaveBeenCalledOnce()
    expect(onLog).toHaveBeenCalledWith({ stream: 'stdout', line: 'real line' })
  })
})

describe('createLineSplitter', () => {
  it('splits on LF and invokes callback per line', async () => {
    const { createLineSplitter } = await import('../templates')
    const lines: string[] = []
    const feed = createLineSplitter((l) => lines.push(l))
    feed(Buffer.from('a\nb\nc'))
    feed(Buffer.from('\n'))
    expect(lines).toEqual(['a', 'b', 'c'])
  })

  it('carries a partial tail across chunks', async () => {
    const { createLineSplitter } = await import('../templates')
    const lines: string[] = []
    const feed = createLineSplitter((l) => lines.push(l))
    feed('install')
    feed('ing deps')
    feed(Buffer.from('...\ndone\n'))
    expect(lines).toEqual(['installing deps...', 'done'])
  })

  it('strips trailing CR from CRLF line endings', async () => {
    const { createLineSplitter } = await import('../templates')
    const lines: string[] = []
    const feed = createLineSplitter((l) => lines.push(l))
    feed(Buffer.from('one\r\ntwo\r\n'))
    expect(lines).toEqual(['one', 'two'])
  })

  it('drops whitespace-only lines', async () => {
    const { createLineSplitter } = await import('../templates')
    const lines: string[] = []
    const feed = createLineSplitter((l) => lines.push(l))
    feed(Buffer.from('   \n\t\nhello\n'))
    expect(lines).toEqual(['hello'])
  })
})

describe('classifyExecError', () => {
  it('maps AbortError to cancelled', async () => {
    const { classifyExecError } = await import('../templates')
    const err = Object.assign(new Error('aborted'), { name: 'AbortError', code: 'ABORT_ERR' })
    expect(classifyExecError(err, '').reason).toBe('cancelled')
  })

  it('maps killed/SIGTERM to timeout', async () => {
    const { classifyExecError } = await import('../templates')
    const err = Object.assign(new Error('timed out'), { killed: true, signal: 'SIGTERM' })
    expect(classifyExecError(err, '').reason).toBe('timeout')
  })

  it('maps ETIMEDOUT to timeout', async () => {
    const { classifyExecError } = await import('../templates')
    const err = Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })
    expect(classifyExecError(err, '').reason).toBe('timeout')
  })

  it('maps ENOENT to tool-missing', async () => {
    const { classifyExecError } = await import('../templates')
    const err = Object.assign(new Error('spawn npx ENOENT'), { code: 'ENOENT' })
    expect(classifyExecError(err, '').reason).toBe('tool-missing')
  })

  it('falls through to failed and surfaces stderr', async () => {
    const { classifyExecError } = await import('../templates')
    const err = Object.assign(new Error('nope'), { code: 42 })
    const cls = classifyExecError(err, 'something broke')
    expect(cls.reason).toBe('failed')
    expect(cls.stderr).toBe('something broke')
  })
})
