import { execFileSync } from 'child_process'

/**
 * Returns process.env with PATH sourced from the user's login shell.
 *
 * When Electron is launched from Finder/Dock (release builds), process.env.PATH is
 * minimal (/usr/bin:/bin:/usr/sbin:/sbin) and CLIs installed via Homebrew, nvm,
 * pyenv, etc. are not found (ENOENT). Spawning a login shell ensures we see the
 * same PATH the user sees in a terminal.
 *
 * The login shell probe runs once and the result is cached for the process lifetime.
 * Falls back to hardcoded Homebrew locations if the shell probe fails.
 */

let _loginPath: string | null = null

function resolveLoginPath(): string {
  if (_loginPath !== null) return _loginPath
  const userShell = process.env.SHELL || '/bin/zsh'
  try {
    const out = execFileSync(userShell, ['-l', '-c', 'echo $PATH'], {
      encoding: 'utf8',
      timeout: 5000,
      env: process.env,
    }).trim()
    if (out) {
      _loginPath = out
      return _loginPath
    }
  } catch { /* fall through to hardcoded fallback */ }
  _loginPath = ['/opt/homebrew/bin', '/usr/local/bin', process.env.PATH ?? ''].join(':')
  return _loginPath
}

export function enrichedEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PATH: resolveLoginPath() }
}
