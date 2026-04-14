/**
 * Main-process logger.
 *
 * Thin wrapper over console so we can:
 *  - Silence debug output in production builds
 *  - Add structured fields consistently
 *  - Forward errors to electron-log (file) or Sentry via setErrorReporter()
 *
 * Intentionally free of Electron imports — usable in UtilityProcess workers
 * (agentWorker.ts) that run without Electron APIs.
 *
 * In the main process, call setErrorReporter() early in index.ts to wire
 * errors to electron-log for persistent file logging. UtilityProcess workers
 * don't set a reporter — they log to stdout only.
 *
 * Usage:
 *   import { logger } from '../lib/logger'
 *   logger.info('Window created', { width: 1280 })
 *   logger.error('IPC handler threw', err)
 */

// ─── Error reporter extension point ──────────────────────────────────────────
// Set once at startup in the main process (index.ts). Not called in UtilityProcess.

type ErrorReporter = (msg: string, err?: unknown) => void
let _reporter: ErrorReporter | null = null

/** Wire in electron-log or Sentry. Call once from main process index.ts. */
export function setErrorReporter(reporter: ErrorReporter): void {
  _reporter = reporter
}

// ─── Logger ───────────────────────────────────────────────────────────────────

function isDev(): boolean {
  return process.env.NODE_ENV !== 'production'
}

function fmt(level: string, msg: string): string {
  return `[braid:${level}] ${msg}`
}

export const logger = {
  debug(msg: string, data?: unknown): void {
    if (!isDev()) return
    data !== undefined ? console.debug(fmt('debug', msg), data) : console.debug(fmt('debug', msg))
  },

  info(msg: string, data?: unknown): void {
    data !== undefined ? console.log(fmt('info', msg), data) : console.log(fmt('info', msg))
  },

  warn(msg: string, data?: unknown): void {
    data !== undefined ? console.warn(fmt('warn', msg), data) : console.warn(fmt('warn', msg))
  },

  error(msg: string, err?: unknown): void {
    err !== undefined ? console.error(fmt('error', msg), err) : console.error(fmt('error', msg))
    // Forward to electron-log file / Sentry (no-op until setErrorReporter is called)
    _reporter?.(msg, err)
  },
}
