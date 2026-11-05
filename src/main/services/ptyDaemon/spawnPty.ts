/**
 * Spawn a node-pty process with one retry and enriched diagnostics on failure.
 * Transient posix_spawn failures (fd exhaustion, resource contention) often
 * resolve after a brief delay.
 */
import { accessSync, existsSync, constants as fsConstants } from 'fs'

export interface SpawnPtyOptions {
  cols: number
  rows: number
  cwd: string
  env: Record<string, string>
}

export async function spawnPty(
  shell: string,
  args: string[],
  opts: SpawnPtyOptions,
  context: { sessionCount: number } = { sessionCount: 0 },
): Promise<import('node-pty').IPty> {
  const nodePty = await import('node-pty')
  const maxAttempts = 2

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return nodePty.spawn(shell, args, { name: 'xterm-256color', ...opts })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // Only retry transient posix_spawn resource contention, not permanent
      // config errors (invalid shell, bad permissions) which won't self-resolve.
      const isTransient = msg.includes('posix_spawnp failed')
      if (isTransient && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 200))
        continue
      }
      const diag = collectSpawnDiagnostics(shell, opts.cwd)
      throw new Error(
        `PTY spawn failed (shell: ${shell}, cwd: ${opts.cwd}, sessions: ${context.sessionCount}${diag}): ${msg}`,
        { cause: err },
      )
    }
  }
  throw new Error('unreachable')
}

function collectSpawnDiagnostics(shell: string, cwd: string): string {
  const parts: string[] = []
  // Only check shell executability for absolute/relative paths.
  // Bare command names (e.g. 'zsh', 'powershell.exe') are resolved via PATH by
  // node-pty, so accessSync would incorrectly report them as not-executable.
  // Match either separator so Windows paths (C:\...) are recognized too.
  if (/[\\/]/.test(shell)) {
    if (!existsSync(shell)) {
      parts.push('shell-check: not-found')
    } else {
      try {
        accessSync(shell, fsConstants.X_OK)
      } catch {
        parts.push('shell-check: not-executable')
      }
    }
  }
  if (!existsSync(cwd)) {
    parts.push('cwd-check: not-found')
  }
  return parts.length > 0 ? ', ' + parts.join(', ') : ''
}
