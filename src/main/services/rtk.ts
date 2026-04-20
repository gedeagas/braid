/**
 * RTK (Rust Token Killer) binary lifecycle service.
 * Downloads and manages the RTK binary that compresses Bash output by ~80%.
 *
 * Rewrite logic delegates to `rtk rewrite <cmd>` so the Rust binary is the
 * single source of truth for which commands benefit from compression.
 * See: https://github.com/rtk-ai/rtk/tree/master/hooks/claude
 */
import { existsSync, mkdirSync, chmodSync } from 'fs'
import { createWriteStream } from 'fs'
import * as https from 'https'
import * as http from 'http'
import type { IncomingMessage } from 'http'
import { join } from 'path'
import { homedir } from 'os'
import { execFile, execFileSync } from 'child_process'
import { logger } from '../lib/logger'

const REPO = 'rtk-ai/rtk'
const BINARY_DIR = join(homedir(), 'Braid', 'binaries', 'rtk')
const BINARY_PATH = join(BINARY_DIR, 'rtk')

const PLATFORM_MAP: Record<string, string> = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'linux-x64': 'x86_64-unknown-linux-musl',
}

export function getPlatformTarget(): string | null {
  const key = `${process.platform}-${process.arch}`
  return PLATFORM_MAP[key] ?? null
}

/**
 * Exit code protocol for `rtk rewrite`:
 *   0 + stdout  - Rewrite found, auto-allow
 *   1           - No RTK equivalent, pass through unchanged
 *   2           - Deny rule matched, pass through
 *   3 + stdout  - Ask rule matched, rewrite but prompt user
 */
export interface RtkRewriteResult {
  rewritten: boolean
  command: string
}

/**
 * Delegates rewrite logic to `rtk rewrite <cmd>`.
 * Uses execFileSync since the Rust binary returns in <5ms and we need
 * the result inline within canUseTool's synchronous allow path.
 *
 * Falls back to simple prefix if `rtk rewrite` is unavailable (version < 0.23.0).
 */
/**
 * Resolve bare `rtk` prefix in rewrite output to the full binary path.
 * The `rtk rewrite` subcommand outputs commands like "rtk git status"
 * but ~/Braid/binaries/rtk/ isn't in PATH, so we need the absolute path.
 */
function resolveRtkInOutput(rtkPath: string, output: string): string {
  if (output === 'rtk' || output.startsWith('rtk ')) {
    return rtkPath + output.slice(3)
  }
  return output
}

export function rewriteCommand(rtkPath: string, command: string, debug = false): RtkRewriteResult {
  try {
    const result = execFileSync(rtkPath, ['rewrite', command], {
      encoding: 'utf-8',
      timeout: 5000,
    })
    // Exit code 0 - rewrite found
    const rewritten = result.trim()
    if (rewritten && rewritten !== command) {
      const resolved = resolveRtkInOutput(rtkPath, rewritten)
      if (debug) {
        logger.info(`[RTK] rewrite: "${command}" -> "${resolved}"`)
      }
      return { rewritten: true, command: resolved }
    }
    return { rewritten: false, command }
  } catch (err: unknown) {
    const exitCode = (err as { status?: number }).status
    switch (exitCode) {
      case 1: // No RTK equivalent - pass through
        if (debug) logger.info(`[RTK] no rewrite for: "${command}"`)
        return { rewritten: false, command }
      case 2: // Deny rule - pass through (Braid handles permissions)
        if (debug) logger.info(`[RTK] deny rule matched: "${command}"`)
        return { rewritten: false, command }
      case 3: {
        // Ask rule - rewrite but flag for prompting (we ignore the ask signal
        // since Braid has its own permission model, just use the rewrite)
        const stdout = (err as { stdout?: string }).stdout?.trim()
        if (stdout) {
          const resolved = resolveRtkInOutput(rtkPath, stdout)
          if (debug) logger.info(`[RTK] ask-rewrite: "${command}" -> "${resolved}"`)
          return { rewritten: true, command: resolved }
        }
        return { rewritten: false, command }
      }
      default:
        // rtk rewrite unavailable (old version or error) - fall back to prefix
        if (debug) logger.info(`[RTK] rewrite unavailable (exit ${exitCode}), using prefix fallback`)
        return fallbackWrap(rtkPath, command, debug)
    }
  }
}

/**
 * Fallback for rtk < 0.23.0 that doesn't support `rtk rewrite`.
 * Simple prefix approach - just prepends the rtk binary path.
 */
const INTERACTIVE_CMDS = new Set([
  'vim', 'nano', 'less', 'top', 'htop', 'vi', 'emacs', 'man', 'more',
])

function fallbackWrap(rtkPath: string, command: string, debug = false): RtkRewriteResult {
  const trimmed = command.trim()
  if (trimmed.startsWith('rtk ') || trimmed.startsWith(rtkPath)) {
    return { rewritten: false, command }
  }
  const firstWord = trimmed.split(/\s/)[0]
  if (INTERACTIVE_CMDS.has(firstWord)) {
    return { rewritten: false, command }
  }
  const wrapped = `${rtkPath} ${command}`
  if (debug) logger.info(`[RTK] fallback wrap: "${command}" -> "${wrapped}"`)
  return { rewritten: true, command: wrapped }
}

/** Awareness prompt injected into system prompt when RTK is enabled. */
export const RTK_AWARENESS_PROMPT = `# RTK - Rust Token Killer

**Usage**: Token-optimized CLI proxy (60-90% savings on dev operations)

## Meta Commands (always use rtk directly)

\`\`\`bash
rtk gain              # Show token savings analytics
rtk gain --history    # Show command usage history with savings
rtk discover          # Analyze session history for missed opportunities
rtk proxy <cmd>       # Execute raw command without filtering (for debugging)
\`\`\`

## Hook-Based Usage

All other commands are automatically rewritten by the RTK hook.
Example: \`git status\` is transparently rewritten to \`rtk git status\` (0 tokens overhead).
`

async function fetchLatestVersion(): Promise<string> {
  const url = `https://api.github.com/repos/${REPO}/releases/latest`
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Braid' } }, (res) => {
      if (res.statusCode === 302 && res.headers.location) {
        // Follow redirect
        https.get(res.headers.location, { headers: { 'User-Agent': 'Braid' } }, (res2) => {
          let data = ''
          res2.on('data', (chunk: Buffer) => { data += chunk.toString() })
          res2.on('end', () => {
            try {
              const json = JSON.parse(data)
              resolve(json.tag_name as string)
            } catch (e) { reject(new Error('Failed to parse release JSON')) }
          })
          res2.on('error', reject)
        }).on('error', reject)
        return
      }
      let data = ''
      res.on('data', (chunk: Buffer) => { data += chunk.toString() })
      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          resolve(json.tag_name as string)
        } catch (e) { reject(new Error('Failed to parse release JSON')) }
      })
      res.on('error', reject)
    }).on('error', reject)
  })
}

export type RtkProgressCallback = (downloaded: number, total: number) => void

function downloadFile(url: string, outPath: string, onProgress?: RtkProgressCallback): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const get = (currentUrl: string, redirects = 0) => {
      if (redirects > 10) { reject(new Error('Too many redirects')); return }
      const mod = currentUrl.startsWith('https://') ? https : http
      mod.get(currentUrl, { headers: { 'User-Agent': 'Braid' } }, (res: IncomingMessage) => {
        if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
          res.resume()
          get(res.headers.location, redirects + 1)
          return
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed: HTTP ${res.statusCode} from ${currentUrl}`))
          return
        }
        const total = parseInt(res.headers['content-length'] ?? '0', 10)
        let downloaded = 0
        const out = createWriteStream(outPath)
        res.on('data', (chunk: Buffer) => {
          downloaded += chunk.length
          if (onProgress && total > 0) onProgress(downloaded, total)
        })
        res.pipe(out)
        out.on('finish', () => resolve())
        out.on('error', reject)
        res.on('error', reject)
      }).on('error', reject)
    }
    get(url)
  })
}

function extractTarGz(tarPath: string, outDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('tar', ['xzf', tarPath, '-C', outDir], (err) => {
      if (err) reject(new Error(`tar extract failed: ${err.message}`))
      else resolve()
    })
  })
}

class RtkService {
  isAvailable(): boolean {
    return existsSync(BINARY_PATH)
  }

  getBinaryPath(): string | null {
    return this.isAvailable() ? BINARY_PATH : null
  }

  async ensureInstalled(onProgress?: RtkProgressCallback): Promise<string> {
    if (this.isAvailable()) return BINARY_PATH

    const target = getPlatformTarget()
    if (!target) throw new Error(`Unsupported platform: ${process.platform}-${process.arch}`)

    logger.info('[RTK] Fetching latest version...')
    const version = await fetchLatestVersion()
    logger.info(`[RTK] Latest version: ${version}`)

    const tarName = `rtk-${target}.tar.gz`
    const downloadUrl = `https://github.com/${REPO}/releases/download/${version}/${tarName}`

    mkdirSync(BINARY_DIR, { recursive: true })
    const tarPath = join(BINARY_DIR, tarName)

    logger.info(`[RTK] Downloading from ${downloadUrl}`)
    await downloadFile(downloadUrl, tarPath, onProgress)

    logger.info('[RTK] Extracting...')
    await extractTarGz(tarPath, BINARY_DIR)

    // chmod the binary
    if (existsSync(BINARY_PATH)) {
      chmodSync(BINARY_PATH, 0o755)
    } else {
      throw new Error('RTK binary not found after extraction')
    }

    logger.info('[RTK] Installation complete')
    return BINARY_PATH
  }

  async getStatus(): Promise<{ installed: boolean; version: string | null; path: string | null }> {
    const installed = this.isAvailable()
    if (!installed) return { installed, version: null, path: null }

    let version: string | null = null
    try {
      version = await new Promise<string>((resolve, reject) => {
        execFile(BINARY_PATH, ['--version'], (err, stdout) => {
          if (err) reject(err)
          else resolve(stdout.trim())
        })
      })
    } catch { /* version unknown */ }

    return { installed, version, path: BINARY_PATH }
  }
}

export const rtkService = new RtkService()
