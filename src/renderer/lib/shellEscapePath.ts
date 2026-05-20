/**
 * Shell-escape a file path for safe pasting into a POSIX terminal.
 * Paths containing only safe characters are returned as-is.
 * All others are wrapped in single quotes with internal `'` escaped.
 */
export function shellEscapePath(path: string): string {
  if (/^[a-zA-Z0-9_./@:-]+$/.test(path)) return path
  return `'${path.replace(/'/g, "'\\''")}'`
}
