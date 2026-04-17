import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import { logger } from '../lib/logger'
import { enrichedEnv, waitForEnrichedEnv } from '../lib/enrichedEnv'
import { PROJECT_NAME_REGEX } from '../../shared/projectName'

export type TemplateKind = 'nextjs'

export interface CreateTemplateArgs {
  parentDir: string
  projectName: string
}

/**
 * Classified failure reasons. The renderer maps each to a specific i18n
 * string so users see an actionable message instead of a generic "failed".
 */
export type CreateFailureReason =
  | 'invalid-name'
  | 'missing-parent'
  | 'parent-not-directory'
  | 'tool-missing'
  | 'timeout'
  | 'cancelled'
  | 'failed'

export type CreateTemplateResult =
  | { success: true }
  | { success: false; reason: CreateFailureReason; stderr?: string }

export type LogStream = 'stdout' | 'stderr'
export interface TemplateLogEntry {
  stream: LogStream
  /** Single trimmed line; caller is expected to render whitespace-preserved. */
  line: string
}

export interface CreateTemplateOptions {
  /**
   * Called once per stdout/stderr line while the scaffold runs. Useful for
   * surfacing progress in the UI. Calls are synchronous and main-process-only.
   */
  onLog?: (entry: TemplateLogEntry) => void
}

/** 10 minutes - create-next-app may install hundreds of MB of deps. */
export const CREATE_NEXT_APP_TIMEOUT_MS = 600_000

/** Exported so tests can assert argv verbatim without duplicating literals. */
export const CREATE_NEXT_APP_BIN = 'npx'
export const CREATE_NEXT_APP_BASE_ARGS: readonly string[] = [
  '--yes',
  'create-next-app@latest',
]
export const CREATE_NEXT_APP_FLAGS: readonly string[] = [
  '--ts',
  '--app',
  '--tailwind',
  '--eslint',
  '--src-dir',
  '--import-alias', '@/*',
  '--use-npm',
  '--yes',
]

/**
 * Single in-flight scaffold controller. The UI only exposes one scaffold at a
 * time (one dialog, one button), so a single slot is sufficient and avoids
 * leaking request-ID bookkeeping across IPC.
 */
let currentAbort: AbortController | null = null

interface ExecFileLikeError extends Error {
  code?: string | number
  killed?: boolean
  signal?: NodeJS.Signals | string | null
}

/** Map a child_process error into a typed failure reason. Exported for tests. */
export function classifyExecError(
  err: ExecFileLikeError,
  stderr: string
): { reason: CreateFailureReason; stderr?: string } {
  // AbortController.abort() surfaces as AbortError / code ABORT_ERR.
  if (err.name === 'AbortError' || err.code === 'ABORT_ERR') {
    return { reason: 'cancelled' }
  }
  // execFile's `timeout` option kills the child with SIGTERM and sets killed=true.
  if (err.killed === true || err.signal === 'SIGTERM' || err.code === 'ETIMEDOUT') {
    return { reason: 'timeout' }
  }
  // npx itself missing on PATH (user has no Node) surfaces as ENOENT.
  if (err.code === 'ENOENT') {
    return { reason: 'tool-missing', stderr: stderr || err.message }
  }
  return { reason: 'failed', stderr: stderr || err.message }
}

/**
 * Returns a chunk handler that splits incoming bytes into lines and invokes
 * `onLine` once per complete line. Handles CRLF, carries partial tail across
 * chunks. Exported for tests.
 */
export function createLineSplitter(onLine: (line: string) => void): (chunk: Buffer | string) => void {
  let buf = ''
  return (chunk) => {
    buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    let idx: number
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx).replace(/\r$/, '')
      buf = buf.slice(idx + 1)
      if (line.trim().length > 0) onLine(line)
    }
  }
}

/**
 * Spawn `npx` directly via argv. No shell, no string composition.
 * PATH comes from enrichedEnv() so Homebrew/nvm/fnm binaries are visible even
 * when Electron was launched from Finder with a minimal PATH.
 *
 * `execFile(..., cb)` returns a ChildProcess whose stdout/stderr we tap for
 * line-by-line progress streaming via `onLog`.
 */
function runNpx(
  args: string[],
  cwd: string,
  signal: AbortSignal,
  onLog?: (entry: TemplateLogEntry) => void
): Promise<CreateTemplateResult> {
  return new Promise<CreateTemplateResult>((resolve) => {
    const child = execFile(
      CREATE_NEXT_APP_BIN,
      args,
      {
        cwd,
        timeout: CREATE_NEXT_APP_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024,
        env: enrichedEnv(),
        signal,
      },
      (err, _stdout, stderr) => {
        if (err) {
          const cls = classifyExecError(err as ExecFileLikeError, stderr ?? '')
          logger.warn('[Templates] create-next-app failed', {
            cwd,
            args,
            reason: cls.reason,
            message: err.message,
          })
          resolve({ success: false, reason: cls.reason, stderr: cls.stderr })
          return
        }
        resolve({ success: true })
      }
    )

    // Tap stdout/stderr for progress lines. `child` and its streams may be
    // undefined under some test mocks; guard accordingly.
    if (onLog && child) {
      const stdoutSplitter = createLineSplitter((line) => onLog({ stream: 'stdout', line }))
      const stderrSplitter = createLineSplitter((line) => onLog({ stream: 'stderr', line }))
      child.stdout?.on('data', stdoutSplitter)
      child.stderr?.on('data', stderrSplitter)
    }
  })
}

/**
 * Run `create-next-app` to scaffold `<parentDir>/<projectName>`.
 * `create-next-app` creates the directory AND runs `git init`, so callers
 * must NOT separately initialize a git repo.
 */
async function createNextAppTemplate(
  args: CreateTemplateArgs,
  signal: AbortSignal,
  onLog?: (entry: TemplateLogEntry) => void
): Promise<CreateTemplateResult> {
  if (!args.projectName || !PROJECT_NAME_REGEX.test(args.projectName)) {
    return { success: false, reason: 'invalid-name' }
  }
  if (!args.parentDir) {
    return { success: false, reason: 'missing-parent' }
  }

  // Confirm parentDir exists and is a directory before we spawn. This turns
  // a confusing post-hoc ENOENT from execFile into an actionable error.
  try {
    const st = await fs.stat(args.parentDir)
    if (!st.isDirectory()) {
      return { success: false, reason: 'parent-not-directory' }
    }
  } catch (e) {
    logger.warn('[Templates] parentDir stat failed', {
      parentDir: args.parentDir,
      err: (e as Error).message,
    })
    return { success: false, reason: 'parent-not-directory' }
  }

  // Ensure the login-shell PATH probe has settled before invoking npx.
  await waitForEnrichedEnv()

  const npxArgs = [
    ...CREATE_NEXT_APP_BASE_ARGS,
    args.projectName,
    ...CREATE_NEXT_APP_FLAGS,
  ]

  return runNpx(npxArgs, args.parentDir, signal, onLog)
}

export const templatesService = {
  /** Scaffold a project from a built-in template. At most one runs at a time. */
  async create(
    kind: TemplateKind,
    args: CreateTemplateArgs,
    opts: CreateTemplateOptions = {}
  ): Promise<CreateTemplateResult> {
    // Defensive: if a previous call is somehow still in-flight, abort it.
    currentAbort?.abort()
    const ctrl = new AbortController()
    currentAbort = ctrl
    try {
      switch (kind) {
        case 'nextjs':
          return await createNextAppTemplate(args, ctrl.signal, opts.onLog)
        default: {
          const exhaustive: never = kind
          return {
            success: false,
            reason: 'failed',
            stderr: `Unknown template kind: ${String(exhaustive)}`,
          }
        }
      }
    } finally {
      if (currentAbort === ctrl) currentAbort = null
    }
  },
  /** Abort the in-flight scaffold, if any. Returns true iff something was cancelled. */
  cancel(): boolean {
    if (!currentAbort) return false
    currentAbort.abort()
    currentAbort = null
    return true
  },
}

export type TemplatesService = typeof templatesService
