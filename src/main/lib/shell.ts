/**
 * Cross-platform shell resolution and launch-argument construction.
 *
 * This module is deliberately free of any Electron dependency so it can be
 * imported by BOTH the Electron main process (pty.ts, ptyDaemon/adapter.ts)
 * and the standalone forked PTY daemon (ptyDaemon/sessionHost.ts, daemonMain.ts).
 * Keeping a single source of truth here prevents the in-process and daemon
 * spawn paths from drifting apart and producing different launch args for the
 * same shell.
 */
import { accessSync, existsSync, lstatSync, constants as fsConstants } from 'fs'
import { execFileSync } from 'child_process'
import { win32 as pathWin32 } from 'path'

export const isWindows = process.platform === 'win32'

/** True if the given path exists and is executable (resolves dangling symlinks). */
export function isExecutableShell(shellPath: string): boolean {
  try {
    const stat = lstatSync(shellPath)
    if (stat.isSymbolicLink() && !existsSync(shellPath)) return false
    accessSync(shellPath, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Platform default shell when nothing is configured and $SHELL is unset. */
export function defaultShellPath(): string {
  if (isWindows) {
    // Windows PowerShell ships in-box at a stable path; fall back to cmd.exe.
    const systemRoot = process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows'
    const powershell = pathWin32.join(
      systemRoot,
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    )
    if (existsSync(powershell)) return powershell
    return process.env.ComSpec ?? pathWin32.join(systemRoot, 'System32', 'cmd.exe')
  }
  return process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh'
}

/**
 * Resolve the interactive shell to launch: explicit config → $SHELL → the
 * user's login shell (macOS only) → platform default. The macOS Directory
 * Services lookup is the historical last resort; it is skipped everywhere else.
 */
export function resolveShellPath(configured?: string): string {
  if (configured && isExecutableShell(configured)) return configured
  if (process.env.SHELL && isExecutableShell(process.env.SHELL)) return process.env.SHELL
  if (process.platform === 'darwin') {
    try {
      const out = execFileSync(
        'dscl',
        ['.', '-read', `/Users/${process.env.USER ?? 'root'}`, 'UserShell'],
        { encoding: 'utf8', timeout: 2000 },
      )
      const match = out.match(/UserShell:\s*(\S+)/)
      if (match && isExecutableShell(match[1])) return match[1]
    } catch {
      /* ignore - fall through to default */
    }
  }
  return defaultShellPath()
}

type ShellKind = 'cmd' | 'powershell' | 'gitbash' | 'wsl' | 'posix'

/**
 * Classify a shell from its path alone, independent of the host platform, so
 * the result is deterministic and unit-testable on any OS. `path.win32.basename`
 * treats both `/` and `\` as separators, so it handles POSIX and Windows paths.
 */
function classifyShell(shellPath: string): ShellKind {
  const base = pathWin32.basename(shellPath).toLowerCase()
  if (base === 'cmd.exe') return 'cmd'
  if (base === 'powershell.exe' || base === 'pwsh.exe' || base === 'pwsh') return 'powershell'
  if (base === 'wsl.exe') return 'wsl'
  if (base === 'bash.exe' || base === 'sh.exe' || base === 'git-bash.exe') return 'gitbash'
  return 'posix'
}

export interface ShellLaunchArgs {
  args: string[]
}

/**
 * Build the argv for launching a shell, either as an interactive session
 * (`opts.command` omitted) or to run a single command and exit.
 *
 * POSIX behavior is preserved exactly (login shell, `-l` / `-l -c`). Windows
 * branches per shell family:
 *  - cmd.exe       → `/K chcp 65001 > nul` (UTF-8/CJK) | `/C <cmd>`
 *  - powershell    → `-NoLogo -NoExit` | `-NoLogo -NoProfile -Command <cmd>`
 *  - Git Bash      → `--login -i` | `--login -c <cmd>`
 *  - wsl.exe       → login bash (full cwd translation lands in a later phase)
 */
export function resolveShellLaunchArgs(
  shellPath: string,
  opts: { command?: string } = {},
): ShellLaunchArgs {
  const { command } = opts
  switch (classifyShell(shellPath)) {
    case 'cmd':
      return { args: command ? ['/C', command] : ['/K', 'chcp 65001 > nul'] }
    case 'powershell':
      return command
        ? { args: ['-NoLogo', '-NoProfile', '-Command', command] }
        : { args: ['-NoLogo', '-NoExit'] }
    case 'gitbash':
      return command ? { args: ['--login', '-c', command] } : { args: ['--login', '-i'] }
    case 'wsl':
      return command ? { args: ['--', 'bash', '-lc', command] } : { args: ['--', 'bash', '-li'] }
    case 'posix':
    default:
      return command ? { args: ['-l', '-c', command] } : { args: ['-l'] }
  }
}
