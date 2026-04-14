import { spawn } from 'child_process'
import { createWriteStream, mkdirSync, chmodSync } from 'fs'
import * as https from 'https'
import * as http from 'http'
import * as zlib from 'zlib'
import type { IncomingMessage } from 'http'
import { join } from 'path'
import { homedir } from 'os'
import { findBinary, buildEnrichedPath } from './helpers'
import { resolveConfigs, findInstallCandidate } from './detect'
import type { LspServerConfig } from './types'

export async function installServer(
  configId: string,
  userConfigs: LspServerConfig[],
  enrichedPath: string,
): Promise<{ newEnrichedPath: string }> {
  const configs = resolveConfigs(userConfigs)
  const config = configs.find(c => c.id === configId)
  if (!config) throw new Error(`No LSP config found for id: ${configId}`)

  const candidate = findInstallCandidate(config, enrichedPath)
  if (!candidate) {
    const hint = config.installHint ? ` — ${config.installHint}` : ''
    throw new Error(`No suitable installer found for ${config.label}${hint}`)
  }

  if (candidate.type === 'download') {
    const platformKey = `${process.platform}-${process.arch}`
    const url = candidate.urls[platformKey] ?? candidate.urls['*']
    if (!url) throw new Error(`No download URL for platform ${platformKey}`)
    await downloadBinary(url, configId, candidate.decompress)
    return { newEnrichedPath: buildEnrichedPath() }
  }

  // Command-based install
  const [cmd, ...args] = candidate.command
  const binary = findBinary(cmd, enrichedPath) ?? cmd

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(binary, args, {
      env: { ...process.env, PATH: enrichedPath },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stderr = ''
    proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

    proc.on('exit', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(stderr.trim() || `Install exited with code ${code}`))
      }
    })

    proc.on('error', (err: Error) => {
      reject(new Error(`Failed to run install command: ${err.message}`))
    })
  })

  return { newEnrichedPath: buildEnrichedPath() }
}

function downloadBinary(url: string, configId: string, decompress?: 'gz'): Promise<void> {
  const outDir = join(homedir(), 'Braid', 'lsp-servers')
  mkdirSync(outDir, { recursive: true })
  const outPath = join(outDir, configId)

  return new Promise<void>((resolve, reject) => {
    const get = (currentUrl: string, redirects = 0) => {
      if (redirects > 10) { reject(new Error('Too many redirects')); return }
      const mod = currentUrl.startsWith('https://') ? https : http
      mod.get(currentUrl, (res: IncomingMessage) => {
        if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
          res.resume() // drain before following
          get(res.headers.location, redirects + 1)
          return
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed: HTTP ${res.statusCode} from ${currentUrl}`))
          return
        }
        const out = createWriteStream(outPath)
        const src = decompress === 'gz' ? res.pipe(zlib.createGunzip()) : res
        src.pipe(out)
        out.on('finish', () => resolve())
        out.on('error', reject)
        src.on('error', reject)
      }).on('error', reject)
    }
    get(url)
  }).then(() => {
    chmodSync(outPath, 0o755)
  })
}
