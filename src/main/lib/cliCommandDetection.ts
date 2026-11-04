// Find CLI commands the way a user's shell would, plus well-known install
// folders that GUI-launched apps often miss on PATH (version managers, Bun,
// pnpm, Homebrew, Nix...). Pure fs checks - no subprocess per command.
import { accessSync, constants, readdirSync, statSync } from 'fs'
import { homedir } from 'os'
import { delimiter, join } from 'path'

const COMMAND_NAME = /^[A-Za-z0-9._-]+$/

function isExecutableFile(p: string): boolean {
  try {
    if (!statSync(p).isFile()) return false
    accessSync(p, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** ~/.nvm/versions/node/<v>/bin, newest version first (string sort is good enough for vNN.x). */
function nvmBinDirs(home: string): string[] {
  const root = join(home, '.nvm', 'versions', 'node')
  try {
    return readdirSync(root).sort().reverse().map((v) => join(root, v, 'bin'))
  } catch {
    return []
  }
}

/** Install folders checked when PATH misses, in precedence order (version managers before system dirs). */
export function cliInstallDirectories(platform: NodeJS.Platform = process.platform, home: string = homedir()): string[] {
  if (platform === 'win32') return []
  const dirs = [
    ...nvmBinDirs(home),
    join(home, '.volta', 'bin'),
    join(home, '.asdf', 'shims'),
    join(home, '.local', 'share', 'mise', 'shims'),
    join(home, '.local', 'bin'),
    platform === 'darwin' ? join(home, 'Library', 'pnpm') : join(home, '.local', 'share', 'pnpm'),
    join(home, '.yarn', 'bin'),
    join(home, '.bun', 'bin'),
  ]
  if (platform === 'darwin') dirs.push('/opt/homebrew/bin')
  dirs.push('/usr/local/bin')
  if (platform === 'linux') dirs.push('/snap/bin', '/home/linuxbrew/.linuxbrew/bin')
  dirs.push(
    '/nix/var/nix/profiles/default/bin',
    join(home, '.nix-profile', 'bin'),
    join(home, '.opencode', 'bin'),
    join(home, '.vite-plus', 'bin'),
    join(home, '.grok', 'bin'),
  )
  if (platform === 'darwin') dirs.push('/opt/local/bin')
  return dirs
}

export interface CommandSearchOptions {
  pathEnv?: string
  platform?: NodeJS.Platform
  home?: string
  /** Injected for tests. */
  isExecutable?: (p: string) => boolean
}

/** Absolute path for each command found (PATH first, then install folders). Missing commands are absent. */
export function findCommands(commands: readonly string[], opts: CommandSearchOptions = {}): Map<string, string> {
  const isExec = opts.isExecutable ?? isExecutableFile
  const pathDirs = (opts.pathEnv ?? process.env.PATH ?? '').split(delimiter).filter(Boolean)
  const dirs = [...new Set([...pathDirs, ...cliInstallDirectories(opts.platform, opts.home)])]
  const found = new Map<string, string>()
  for (const command of new Set(commands)) {
    if (!COMMAND_NAME.test(command)) continue
    for (const dir of dirs) {
      const candidate = join(dir, command)
      if (isExec(candidate)) {
        found.set(command, candidate)
        break
      }
    }
  }
  return found
}

export function findCommand(command: string, opts: CommandSearchOptions = {}): string | null {
  return findCommands([command], opts).get(command) ?? null
}
