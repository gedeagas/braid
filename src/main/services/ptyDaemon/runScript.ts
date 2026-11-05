// Run a command non-interactively in an in-process PTY and resolve with its
// exit code (archive/setup scripts). Ephemeral, so it never goes through the
// daemon. Resolves -1 on timeout.

import { existsSync } from 'fs'
import { homedir } from 'os'
import { resolveShellLaunchArgs } from '../../lib/shell'

export async function runScriptInPty(shell: string, cwd: string, command: string, timeoutMs = 30_000): Promise<{ exitCode: number }> {
  const nodePty = await import('node-pty')
  const safeCwd = existsSync(cwd) ? cwd : homedir()

  return new Promise((resolve, reject) => {
    let ptyProcess: import('node-pty').IPty
    try {
      ptyProcess = nodePty.spawn(shell, resolveShellLaunchArgs(shell, { command }).args, {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: safeCwd,
        env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      reject(new Error(
        `Failed to spawn terminal (shell: ${shell}, cwd: ${safeCwd}): ${msg}. ` +
        `Check that the shell binary exists and is executable.`,
      ))
      return
    }

    let settled = false
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        ptyProcess.kill()
        resolve({ exitCode: -1 })
      }
    }, timeoutMs)

    ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        resolve({ exitCode })
      }
    })
  })
}
