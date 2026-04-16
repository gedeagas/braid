import { execFile } from 'child_process'

/**
 * Returns process.env with PATH sourced from the user's login shell.
 *
 * When Electron is launched from Finder/Dock (release builds), process.env.PATH is
 * minimal (/usr/bin:/bin:/usr/sbin:/sbin) and CLIs installed via Homebrew, nvm,
 * pyenv, etc. are not found (ENOENT). Spawning a login shell ensures we see the
 * same PATH the user sees in a terminal.
 *
 * The probe runs once eagerly (non-blocking) at module load. `enrichedEnv()` returns
 * the resolved PATH once settled, or the hardcoded Homebrew fallback in the meantime.
 * Await `waitForEnrichedEnv()` before the first CLI invocation to guarantee the probe
 * has settled.
 */

const FALLBACK_PATH = ['/opt/homebrew/bin', '/usr/local/bin', process.env.PATH ?? ''].join(':')
let _loginPath = FALLBACK_PATH

function probe(): Promise<void> {
  const userShell = process.env.SHELL || '/bin/zsh'
  return new Promise<void>((resolve) => {
    // Use -li (login + interactive) so .zshrc/.bashrc are sourced.
    // Tools like nvm, rbenv, pyenv, sdkman load in interactive shell configs,
    // not in login-only profiles. Without -i, their PATHs are missing.
    execFile(userShell, ['-lic', 'echo $PATH'], {
      encoding: 'utf8',
      timeout: 5000,
      env: process.env,
    }, (_err, stdout) => {
      // Take the last non-empty line: interactive shells may print MOTD,
      // neofetch, or other startup output before our echo.
      const lines = (stdout ?? '').split('\n').filter((l) => l.trim())
      const out = lines[lines.length - 1]?.trim()
      if (out) _loginPath = out
      resolve()
    })
  })
}

// Kick off immediately so it's settled before first real CLI use.
const _ready = probe()

/** Await this before the first CLI invocation to guarantee the probe has settled. */
export function waitForEnrichedEnv(): Promise<void> {
  return _ready
}

/** Returns process.env with the login-shell PATH (or Homebrew fallback until probe settles). */
export function enrichedEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PATH: _loginPath }
}
