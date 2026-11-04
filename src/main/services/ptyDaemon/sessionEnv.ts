// Env and foreground-process helpers for daemon sessions, kept apart from
// SessionHost so the persisted shape is easy to audit.

import type { ForegroundKind } from './types'

/**
 * Env keys that identify a Braid terminal and must survive a cold restore so
 * agent hooks keep reporting for it. Secrets (the hook token) are never
 * persisted: the hook script reads them from its own config file.
 */
const PERSISTED_ENV_KEYS = ['BRAID_TERMINAL_ID', 'BRAID_TERMINAL'] as const
const ENV_VALUE_RE = /^[A-Za-z0-9._:-]{1,256}$/

/**
 * The daemon's own env minus inherited Braid terminal identity. If Braid was
 * started from inside a Braid terminal, its env carries that terminal's id;
 * a new or restored shell must never report hooks under someone else's id.
 */
export function baseEnv(): Record<string, string> {
  const env: Record<string, string> = { ...process.env as Record<string, string>, TERM: 'xterm-256color' }
  for (const key of PERSISTED_ENV_KEYS) delete env[key]
  return env
}

/** Pick the env worth persisting. Also re-validates env read back from disk. */
export function persistableEnv(env: Record<string, string> | undefined): Record<string, string> {
  const result: Record<string, string> = {}
  if (!env || typeof env !== 'object') return result
  for (const key of PERSISTED_ENV_KEYS) {
    const value = env[key]
    if (typeof value === 'string' && ENV_VALUE_RE.test(value)) result[key] = value
  }
  return result
}

/**
 * Env to re-apply when restoring a checkpoint. Checkpoints written before env
 * was saved have none; their session id is the terminal id the session was
 * spawned with (the adapter keys sessions by BRAID_TERMINAL_ID), so recover it
 * from there. Daemon-generated ids (`pty-d-`) never had one.
 */
export function restoredEnv(sessionId: string, env: Record<string, string> | undefined): Record<string, string> {
  if (env !== undefined) return persistableEnv(env)
  if (sessionId.startsWith('pty-d-') || !ENV_VALUE_RE.test(sessionId)) return {}
  return { BRAID_TERMINAL_ID: sessionId, BRAID_TERMINAL: '1' }
}

/** Classify a PTY's foreground process name against the shell it runs. */
export function classifyForeground(processName: string | undefined, shell: string): ForegroundKind | undefined {
  if (typeof processName !== 'string' || !processName) return undefined
  const name = processName.replace(/^-/, '').split(/[\\/]/).pop()?.replace(/\.exe$/i, '') ?? ''
  const shellName = shell.split(/[\\/]/).pop()?.replace(/\.exe$/i, '') ?? ''
  return name === shellName ? 'shell' : 'command'
}

/** Validate a foreground value read back from a checkpoint file. */
export function normalizeForeground(raw: unknown): ForegroundKind | undefined {
  return raw === 'shell' || raw === 'command' ? raw : undefined
}
