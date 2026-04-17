import { execFile } from 'child_process'
import { logger } from '../lib/logger'

// Mirror of the renderer-side PROJECT_NAME_REGEX. Defined locally so this
// service does not depend on anything under src/renderer.
const PROJECT_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

export type TemplateKind = 'nextjs'

export interface CreateTemplateArgs {
  parentDir: string
  projectName: string
}

export interface CreateTemplateResult {
  success: boolean
  /** Populated on failure so the renderer can surface a useful message. */
  stderr?: string
}

/**
 * Run a scaffolder command in an interactive login shell so Homebrew, nvm, fnm,
 * and other PATH managers are visible. Mirrors the pattern used elsewhere in
 * ipc.ts (shell:checkTool, shell:installTool, agent:reAuth).
 */
function runInLoginShell(command: string, cwd: string, timeoutMs: number): Promise<CreateTemplateResult> {
  const userShell = process.env.SHELL || '/bin/zsh'
  return new Promise<CreateTemplateResult>((resolve) => {
    execFile(
      userShell,
      ['-l', '-c', command],
      { cwd, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
      (err, _stdout, stderr) => {
        if (err) {
          logger.warn('[Templates] Scaffold command failed', { command, cwd, err: err.message, stderr })
          resolve({ success: false, stderr: stderr || err.message })
          return
        }
        resolve({ success: true })
      }
    )
  })
}

/**
 * Run `create-next-app` in the user's login shell against the npm registry.
 * `create-next-app` creates `<parentDir>/<projectName>` and runs `git init`
 * itself, so callers must not separately initialize a git repo.
 */
async function createNextAppTemplate(args: CreateTemplateArgs): Promise<CreateTemplateResult> {
  if (!PROJECT_NAME_REGEX.test(args.projectName)) {
    return { success: false, stderr: `Invalid project name: ${args.projectName}` }
  }
  if (!args.parentDir) {
    return { success: false, stderr: 'Parent directory is required' }
  }

  // Shell-quote the project name defensively even though the regex already
  // restricts it to a safe subset.
  const safeName = JSON.stringify(args.projectName)
  const command =
    `npx --yes create-next-app@latest ${safeName} ` +
    `--ts --app --tailwind --eslint --src-dir ` +
    `--import-alias "@/*" --use-npm --yes`

  // create-next-app installs dependencies via npm; give it up to 10 minutes.
  return runInLoginShell(command, args.parentDir, 600_000)
}

export const templatesService = {
  async create(kind: TemplateKind, args: CreateTemplateArgs): Promise<CreateTemplateResult> {
    switch (kind) {
      case 'nextjs':
        return createNextAppTemplate(args)
      default: {
        const exhaustive: never = kind
        return { success: false, stderr: `Unknown template kind: ${String(exhaustive)}` }
      }
    }
  },
  // Exported for tests.
  _createNextAppTemplate: createNextAppTemplate,
}

export type TemplatesService = typeof templatesService
