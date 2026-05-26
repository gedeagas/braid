import { execFile } from 'child_process'

/**
 * Hydrates process.env.PATH from the user's login shell.
 *
 * When Electron is launched from Finder/Dock (release builds), process.env.PATH is
 * minimal (/usr/bin:/bin:/usr/sbin:/sbin) and CLIs installed via Homebrew, nvm,
 * pyenv, etc. are not found (ENOENT). Spawning a login shell ensures we see the
 * same PATH the user sees in a terminal.
 *
 * Unlike returning a per-call env object, this mutates process.env.PATH directly
 * so all child_process calls automatically inherit the enriched PATH.
 *
 * The probe runs once eagerly (non-blocking) at module load. Await
 * `waitForEnrichedEnv()` before the first CLI invocation to guarantee the probe
 * has settled.
 */

// Unique delimiters to extract PATH from shell output, resilient to MOTD,
// neofetch, oh-my-zsh banners, and other startup noise.
const DELIM_START = '__BRAID_PATH_START__'
const DELIM_END = '__BRAID_PATH_END__'

// Strip ANSI escape sequences (colored prompts, powerlevel10k, starship, etc.)
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07]*\x07/g

// Prepend common Homebrew paths as immediate fallback before probe settles (macOS only)
if (process.platform !== 'win32') {
  const HOMEBREW_PATHS = ['/opt/homebrew/bin', '/usr/local/bin']
  const currentSegments = new Set((process.env.PATH ?? '').split(':'))
  for (const p of HOMEBREW_PATHS) {
    if (!currentSegments.has(p)) {
      process.env.PATH = process.env.PATH ? `${p}:${process.env.PATH}` : p
    }
  }
}

function probe(): Promise<void> {
  if (process.platform === 'win32') return Promise.resolve()
  const userShell = process.env.SHELL || '/bin/zsh'
  return new Promise<void>((resolve) => {
    // Use -lic (login + interactive) so .zshrc/.bashrc are sourced.
    // Tools like nvm, rbenv, pyenv, sdkman load in interactive shell configs,
    // not in login-only profiles. Without -i, their PATHs are missing.
    const cmd = `printf '%s' '${DELIM_START}'; printf '%s' "$PATH"; printf '%s' '${DELIM_END}'`
    execFile(userShell, ['-lic', cmd], {
      encoding: 'utf8',
      timeout: 5000,
      env: process.env,
    }, (_err, stdout) => {
      const raw = (stdout ?? '').replace(ANSI_RE, '')
      const startIdx = raw.indexOf(DELIM_START)
      const endIdx = raw.indexOf(DELIM_END)
      if (startIdx >= 0 && endIdx > startIdx) {
        const shellPath = raw.slice(startIdx + DELIM_START.length, endIdx).trim()
        if (shellPath) {
          // Merge new segments into process.env.PATH, deduplicating
          const existing = new Set((process.env.PATH ?? '').split(':').filter(Boolean))
          const newSegments = shellPath.split(':').filter((s) => s && !existing.has(s))
          if (newSegments.length > 0) {
            const currentPath = process.env.PATH ? [process.env.PATH] : []
            process.env.PATH = [...newSegments, ...currentPath].join(':')
          }
          console.log('[enrichedEnv] hydrated PATH with %d new segments', newSegments.length)
        }
      } else {
        // Fallback: take the last non-empty line
        const lines = raw.split('\n').filter((l) => l.trim())
        const out = lines[lines.length - 1]?.trim()
        if (out && out.includes('/')) {
          process.env.PATH = out
          console.log('[enrichedEnv] hydrated PATH via fallback')
        }
      }
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

/** Returns process.env (PATH is already mutated in-place by hydration). */
export function enrichedEnv(): NodeJS.ProcessEnv {
  return process.env
}
