/**
 * Cap the scrollback snapshot replayed to a mobile device on subscribe.
 *
 * The desktop keeps a multi-megabyte ring buffer per terminal; shipping all of
 * it as one frame stalls the device's first paint and the phone only renders
 * the tail anyway. Clients on protocol v3+ request a byte budget via `maxBytes`.
 */

/**
 * Keep at most `maxBytes` from the end of `output`, trimmed forward to the first
 * line boundary so the replay never starts mid-line (which would wrap a partial
 * row into the device's narrower grid). Returns the input untouched when it
 * already fits or no budget is requested.
 */
export function budgetScrollback(output: string, maxBytes?: number): string {
  if (!maxBytes || maxBytes <= 0) return output
  // UTF-16 length is a cheap, monotonic proxy for byte length; the cap is a
  // soft ceiling, not an exact size contract, so we avoid re-encoding huge
  // buffers just to measure them.
  if (output.length <= maxBytes) return output
  const tail = output.slice(output.length - maxBytes)
  const nl = tail.indexOf('\n')
  return nl >= 0 && nl < tail.length - 1 ? tail.slice(nl + 1) : tail
}
