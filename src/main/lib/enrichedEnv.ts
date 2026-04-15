/**
 * Returns process.env with PATH enriched to include common Homebrew and local bin dirs.
 *
 * When Electron is launched from Finder/Dock (release builds), process.env.PATH is
 * minimal (/usr/bin:/bin:/usr/sbin:/sbin) and CLIs installed via Homebrew (gh, acli)
 * are not found (ENOENT). Prepending these dirs fixes the lookup.
 *
 * In dev mode (launched from terminal) the extra dirs are typically already in PATH,
 * so prepending them is a harmless no-op.
 */
export function enrichedEnv(): NodeJS.ProcessEnv {
  const envPath = ['/opt/homebrew/bin', '/usr/local/bin', process.env.PATH ?? ''].join(':')
  return { ...process.env, PATH: envPath }
}
