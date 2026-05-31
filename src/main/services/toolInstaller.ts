import { execFile, type ExecFileOptionsWithStringEncoding } from 'child_process'
import { accessSync, chmodSync, constants, existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { enrichedEnv, refreshEnrichedEnv, waitForEnrichedEnv } from '../lib/enrichedEnv'
import {
  isToolInstallKey,
  type ToolInstallKey,
  type ToolInstallOptions,
  type ToolInstallResult,
} from '../../shared/tool-install'

type InstallStrategy =
  | {
      type: 'exec'
      command: string
      args: string[]
      prerequisite?: string
      platforms?: NodeJS.Platform[]
      timeoutMs?: number
      manualCompletion?: boolean
    }
  | {
      type: 'shell'
      command: string
      prerequisite?: string
      platforms?: NodeJS.Platform[]
      timeoutMs?: number
    }
  | {
      type: 'download'
      outputName: string
      url: (platform: NodeJS.Platform, arch: NodeJS.Architecture) => string | null
      prerequisite?: string
      platforms?: NodeJS.Platform[]
      timeoutMs?: number
      systemWide?: boolean
    }
  | {
      type: 'sequence'
      steps: Array<{ command: string; args: string[] }>
      prerequisite?: string
      platforms?: NodeJS.Platform[]
      timeoutMs?: number
    }

interface ToolDefinition {
  label: string
  detectCommand: string
  strategies: InstallStrategy[]
}

interface ExecResult {
  stdout: string
  stderr: string
}

class CommandError extends Error {
  constructor(
    message: string,
    readonly stdout: string,
    readonly stderr: string,
  ) {
    super(message)
  }
}

const DEFAULT_TIMEOUT_MS = 180_000
const CHECK_TIMEOUT_MS = 3_000
const SYSTEM_BIN_DIR = '/usr/local/bin'

const TOOL_DEFINITIONS: Record<ToolInstallKey, ToolDefinition> = {
  git: {
    label: 'Git',
    detectCommand: 'git',
    strategies: [
      {
        type: 'exec',
        command: 'xcode-select',
        args: ['--install'],
        platforms: ['darwin'],
        timeoutMs: 30_000,
        manualCompletion: true,
      },
    ],
  },
  gh: {
    label: 'GitHub CLI',
    detectCommand: 'gh',
    strategies: [
      {
        type: 'exec',
        command: 'brew',
        args: ['install', 'gh'],
        prerequisite: 'brew',
        platforms: ['darwin'],
      },
    ],
  },
  claude: {
    label: 'Claude Code',
    detectCommand: 'claude',
    strategies: [
      {
        type: 'shell',
        command: 'curl -fsSL https://claude.ai/install.sh | bash',
        prerequisite: 'curl',
        timeoutMs: 300_000,
      },
    ],
  },
  acli: {
    label: 'Atlassian CLI',
    detectCommand: 'acli',
    strategies: [
      {
        type: 'sequence',
        prerequisite: 'brew',
        platforms: ['darwin'],
        steps: [
          { command: 'brew', args: ['tap', 'atlassian/homebrew-acli'] },
          { command: 'brew', args: ['install', 'acli'] },
        ],
      },
      {
        type: 'download',
        outputName: 'acli',
        prerequisite: 'curl',
        platforms: ['darwin', 'linux'],
        systemWide: true,
        url: (platform, arch) => {
          const os = platform === 'darwin' ? 'darwin' : platform === 'linux' ? 'linux' : null
          const cpu = arch === 'arm64' ? 'arm64' : arch === 'x64' ? 'amd64' : null
          return os && cpu ? `https://acli.atlassian.com/${os}/latest/acli_${os}_${cpu}/acli` : null
        },
      },
    ],
  },
  mobilecli: {
    label: 'mobilecli',
    detectCommand: 'mobilecli',
    strategies: [
      {
        type: 'exec',
        command: 'brew',
        args: ['install', 'nicklama/tap/mobilecli'],
        prerequisite: 'brew',
        platforms: ['darwin'],
      },
    ],
  },
}

function defaultUserShell(): string {
  return process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh'
}

function shellArgs(shellPath: string, cmd: string): string[] {
  const shellName = shellPath.split('/').pop() ?? ''
  if (shellName === 'sh' || shellName === 'dash') return ['-c', cmd]
  return ['-lic', cmd]
}

function isSupportedPlatform(strategy: InstallStrategy): boolean {
  return !strategy.platforms || strategy.platforms.includes(process.platform)
}

function trimOutput(value: string): string {
  const normalized = value.trim()
  if (normalized.length <= 700) return normalized
  return normalized.slice(-700)
}

function failureDetail(error: unknown): string {
  if (error instanceof CommandError) {
    return trimOutput(error.stderr) || trimOutput(error.stdout) || error.message
  }
  if (error instanceof Error) return error.message
  return String(error)
}

function result(
  key: string,
  success: boolean,
  installed: boolean,
  reason: ToolInstallResult['reason'],
  message: string,
  details: Pick<ToolInstallResult, 'prerequisite' | 'targetPath' | 'requiresAdmin'> = {},
): ToolInstallResult {
  return { key, success, installed, reason, message, ...details }
}

function canWriteDirectory(dir: string): boolean {
  try {
    accessSync(dir, constants.W_OK)
    return true
  } catch {
    return false
  }
}

function canInstallToDirectory(dir: string): boolean {
  if (existsSync(dir)) return canWriteDirectory(dir)
  const parent = dirname(dir)
  return existsSync(parent) && canWriteDirectory(parent)
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

class ToolInstallerService {
  async checkCommand(command: string): Promise<boolean> {
    return (await this.resolveCommand(command)) !== null
  }

  async install(key: string, options: ToolInstallOptions = {}): Promise<ToolInstallResult> {
    if (!isToolInstallKey(key)) {
      return result(key, false, false, 'unknown_tool', `No installer is registered for ${key}.`)
    }

    const definition = TOOL_DEFINITIONS[key]
    if (await this.checkCommand(definition.detectCommand)) {
      return result(key, true, true, 'already_installed', `${definition.label} is already installed.`)
    }

    const supportedStrategies = definition.strategies.filter(isSupportedPlatform)
    const missingPrerequisites: string[] = []
    let strategy: InstallStrategy | null = null

    for (const candidate of supportedStrategies) {
      if (candidate.prerequisite && !(await this.checkCommand(candidate.prerequisite))) {
        missingPrerequisites.push(candidate.prerequisite)
        continue
      }
      strategy = candidate
      break
    }

    if (!strategy) {
      if (supportedStrategies.length > 0 && missingPrerequisites.length > 0) {
        const uniquePrerequisites = [...new Set(missingPrerequisites)]
        return result(
          key,
          false,
          false,
          'missing_prerequisite',
          `${uniquePrerequisites.join(' or ')} is required to install ${definition.label} automatically.`,
          { prerequisite: uniquePrerequisites[0] },
        )
      }

      return result(
        key,
        false,
        false,
        'unsupported_platform',
        `Automatic installation for ${definition.label} is not available on ${process.platform}.`,
      )
    }

    const adminTargetPath = this.adminRequiredTargetPath(strategy)
    if (adminTargetPath && !options.allowAdmin) {
      return result(
        key,
        false,
        false,
        'admin_required',
        `${definition.label} will be installed to ${adminTargetPath}. macOS needs administrator approval to write there.`,
        { targetPath: adminTargetPath, requiresAdmin: true },
      )
    }

    try {
      await this.runStrategy(strategy, options)
    } catch (error) {
      const detail = failureDetail(error)
      return result(
        key,
        false,
        false,
        'install_failed',
        detail ? `Failed to install ${definition.label}: ${detail}` : `Failed to install ${definition.label}.`,
        { prerequisite: strategy.prerequisite },
      )
    }

    await refreshEnrichedEnv()
    const installed = await this.checkCommand(definition.detectCommand)
    if (installed) {
      return result(key, true, true, 'installed', `${definition.label} installed successfully.`)
    }

    if ('manualCompletion' in strategy && strategy.manualCompletion) {
      return result(
        key,
        false,
        false,
        'manual_completion_required',
        `${definition.label} installer was opened. Finish the installer, then re-check.`,
      )
    }

    return result(
      key,
      false,
      false,
      'postcheck_failed',
      `${definition.label} installer completed, but ${definition.detectCommand} was not found on PATH.`,
      { prerequisite: strategy.prerequisite },
    )
  }

  private async resolveCommand(command: string): Promise<string | null> {
    if (!/^[a-zA-Z0-9-]+$/.test(command)) return null
    await waitForEnrichedEnv()
    try {
      const { stdout } = await this.execFileText('which', [command], {
        timeout: CHECK_TIMEOUT_MS,
        env: enrichedEnv(),
        encoding: 'utf8',
      })
      return stdout.split(/\r?\n/).map((line) => line.trim()).find((line) => line.startsWith('/')) ?? null
    } catch {
      return null
    }
  }

  private adminRequiredTargetPath(strategy: InstallStrategy): string | null {
    if (strategy.type !== 'download' || !strategy.systemWide) return null
    if (canInstallToDirectory(SYSTEM_BIN_DIR)) return null
    if (process.platform === 'darwin') return join(SYSTEM_BIN_DIR, strategy.outputName)
    return null
  }

  private async runStrategy(strategy: InstallStrategy, options: ToolInstallOptions): Promise<ExecResult> {
    if (strategy.type === 'shell') {
      const shellPath = process.env.SHELL || defaultUserShell()
      return this.execFileText(shellPath, shellArgs(shellPath, strategy.command), {
        timeout: strategy.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        env: enrichedEnv(),
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
      })
    }

    if (strategy.type === 'download') {
      const url = strategy.url(process.platform, process.arch)
      if (!url) {
        throw new Error(`No download URL for ${process.platform}-${process.arch}`)
      }

      const outputPath = strategy.systemWide
        ? join(SYSTEM_BIN_DIR, strategy.outputName)
        : join(process.cwd(), strategy.outputName)

      if (strategy.systemWide && !canInstallToDirectory(SYSTEM_BIN_DIR)) {
        if (process.platform === 'darwin' && options.allowAdmin) {
          const command = [
            `/bin/mkdir -p ${shellQuote(SYSTEM_BIN_DIR)}`,
            `/usr/bin/curl -fL ${shellQuote(url)} -o ${shellQuote(outputPath)}`,
            `/bin/chmod 755 ${shellQuote(outputPath)}`,
            `/usr/sbin/chown root:wheel ${shellQuote(outputPath)}`,
          ].join(' && ')
          return this.execFileText('osascript', [
            '-e',
            `do shell script ${JSON.stringify(command)} with administrator privileges`,
          ], {
            timeout: strategy.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            env: enrichedEnv(),
            encoding: 'utf8',
            maxBuffer: 1024 * 1024,
          })
        }

        throw new Error(`${SYSTEM_BIN_DIR} is not writable. Install ${strategy.outputName} manually or approve administrator privileges.`)
      }

      if (strategy.systemWide) {
        mkdirSync(SYSTEM_BIN_DIR, { recursive: true })
      }
      const download = await this.execFileText('curl', ['-fL', url, '-o', outputPath], {
        timeout: strategy.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        env: enrichedEnv(),
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
      })
      chmodSync(outputPath, 0o755)
      return download
    }

    if (strategy.type === 'sequence') {
      let lastResult: ExecResult = { stdout: '', stderr: '' }
      for (const step of strategy.steps) {
        lastResult = await this.execFileText(step.command, step.args, {
          timeout: strategy.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          env: enrichedEnv(),
          encoding: 'utf8',
          maxBuffer: 1024 * 1024,
        })
      }
      return lastResult
    }

    return this.execFileText(strategy.command, strategy.args, {
      timeout: strategy.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      env: enrichedEnv(),
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    })
  }

  private execFileText(
    file: string,
    args: string[],
    options: ExecFileOptionsWithStringEncoding,
  ): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      execFile(file, args, options, (error, stdout, stderr) => {
        if (error) {
          reject(new CommandError(error.message, stdout, stderr))
          return
        }
        resolve({ stdout, stderr })
      })
    })
  }
}

export const toolInstaller = new ToolInstallerService()
