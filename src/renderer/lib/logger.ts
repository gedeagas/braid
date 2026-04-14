/**
 * Renderer-process logger.
 *
 * Mirrors the main-process logger API so shared patterns work across both
 * processes without a dependency on Electron APIs.
 *
 * Usage:
 *   import { logger } from '@/lib/logger'
 *   logger.info('Store hydrated', { sessions: 3 })
 *   logger.error('IPC call failed', err)
 */

const isDev = import.meta.env.DEV

function fmt(level: string, msg: string): string {
  return `[braid:${level}] ${msg}`
}

export const logger = {
  debug(msg: string, data?: object): void {
    if (!isDev) return
    data !== undefined ? console.debug(fmt('debug', msg), data) : console.debug(fmt('debug', msg))
  },

  info(msg: string, data?: object): void {
    data !== undefined ? console.log(fmt('info', msg), data) : console.log(fmt('info', msg))
  },

  warn(msg: string, data?: object): void {
    data !== undefined ? console.warn(fmt('warn', msg), data) : console.warn(fmt('warn', msg))
  },

  error(msg: string, err?: unknown): void {
    err !== undefined ? console.error(fmt('error', msg), err) : console.error(fmt('error', msg))
  },
}
