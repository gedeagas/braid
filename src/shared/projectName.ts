/**
 * Shared validation for user-supplied project/directory names.
 *
 * Lives in src/shared/ so it can be consumed from main, preload, and renderer
 * without violating layer boundaries. Keep this file dependency-free.
 *
 * Rules are a tight intersection of:
 *   - POSIX/macOS filesystem safety (no whitespace, `/`, NUL, etc.)
 *   - Safe CLI interpolation (still passed via argv, but defence-in-depth)
 *   - npm package-name rules (create-next-app writes name -> package.json)
 *
 * npm's own spec allows up to 214 chars, lowercase only, URL-safe, and
 * disallows a handful of reserved names. We mirror that subset so the
 * "Empty" and "Next.js" templates share the same contract.
 */

export const MAX_PROJECT_NAME_LENGTH = 214

/**
 * Final-pass regex used as a defence-in-depth guard in the main process.
 * The richer `validateProjectName` below is what the UI uses for per-reason
 * feedback; both must agree on the accept set.
 */
export const PROJECT_NAME_REGEX = /^[a-z0-9][a-z0-9._-]*$/

/**
 * Names npm itself refuses (and/or that create unworkable projects).
 * Keep minimal; we don't try to reproduce the full builtin-modules list.
 */
const RESERVED_NAMES = new Set<string>([
  'node_modules',
  'favicon.ico',
])

export type ProjectNameIssueReason =
  | 'empty'
  | 'too-long'
  | 'starts-with-dot'
  | 'starts-with-underscore'
  | 'starts-with-hyphen'
  | 'uppercase'
  | 'has-space'
  | 'invalid-chars'
  | 'reserved'

export interface ProjectNameIssue {
  reason: ProjectNameIssueReason
  /**
   * For `invalid-chars`, the first offending character in the input.
   * For `reserved`, the name itself. Used to render richer error copy.
   */
  detail?: string
}

/**
 * Validate a project name. Returns `null` if valid, otherwise the first
 * issue encountered (ordering matters: we report the most actionable
 * violation first, e.g. "uppercase" before "invalid-chars").
 *
 * Pure function: no I/O, no locale dependence.
 */
export function validateProjectName(raw: string): ProjectNameIssue | null {
  if (raw.length === 0) return { reason: 'empty' }
  if (raw.length > MAX_PROJECT_NAME_LENGTH) return { reason: 'too-long' }

  const first = raw.charAt(0)
  if (first === '.') return { reason: 'starts-with-dot' }
  if (first === '_') return { reason: 'starts-with-underscore' }
  if (first === '-') return { reason: 'starts-with-hyphen' }

  if (/\s/.test(raw)) return { reason: 'has-space' }
  if (/[A-Z]/.test(raw)) return { reason: 'uppercase' }

  if (!PROJECT_NAME_REGEX.test(raw)) {
    // Surface the first disallowed char to make the error specific.
    const bad = Array.from(raw).find((c) => !/[a-z0-9._-]/.test(c))
    return { reason: 'invalid-chars', detail: bad }
  }

  if (RESERVED_NAMES.has(raw)) return { reason: 'reserved', detail: raw }

  return null
}

export function isValidProjectName(name: string): boolean {
  return validateProjectName(name) === null
}
