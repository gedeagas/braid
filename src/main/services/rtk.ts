/**
 * RTK (Rust Token Killer) binary lifecycle service.
 * Downloads and manages the RTK binary that compresses Bash output by ~80%.
 */
import { existsSync, mkdirSync, chmodSync } from 'fs'
import { createWriteStream } from 'fs'
import * as https from 'https'
import * as http from 'http'
import type { IncomingMessage } from 'http'
import { join } from 'path'
import { homedir } from 'os'
import { execFile } from 'child_process'
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

const INTERACTIVE_CMDS = new Set([
  'vim', 'nano', 'less', 'top', 'htop', 'vi', 'emacs', 'man', 'more',
])

export function getPlatformTarget(): string | null {
  const key = `${process.platform}-${process.arch}`
  return PLATFORM_MAP[key] ?? null
}

export function wrapWithRtk(rtkPath: string, command: string): string {
  const trimmed = command.trim()
  if (trimmed.startsWith('rtk ') || trimmed.startsWith(rtkPath)) return command
  const firstWord = trimmed.split(/\s/)[0]
  if (INTERACTIVE_CMDS.has(firstWord)) return command
  return `${rtkPath} ${command}`
}

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
