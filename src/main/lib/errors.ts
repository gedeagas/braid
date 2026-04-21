/**
 * Returns true if `err` is a Node.js EPIPE error.
 *
 * EPIPE is expected when an IPC channel or pipe closes before all writes
 * drain — e.g. the parent UtilityProcess terminates mid-stream.
 */
export function isEpipe(err: unknown): err is NodeJS.ErrnoException & { code: 'EPIPE' } {
  return (
    err instanceof Error &&
    'code' in err &&
    (err as Record<string, unknown>).code === 'EPIPE'
  )
}
