import { spawn } from 'child_process'
import { existsSync, readFileSync, statSync, writeFileSync } from 'fs'
import { join, relative } from 'path'
import { logger } from '../lib/logger'
import { enrichedEnv, waitForEnrichedEnv } from '../lib/enrichedEnv'
import { BUNDLED_RG_PATH } from './rgPath'
import type {
  ReplaceResult,
  SearchFileResult,
  SearchMatch,
  SearchOptions,
  SearchResult,
} from '../../shared/search'
import { DEFAULT_MAX_RESULTS } from '../../shared/search'

interface RgMatchJson {
  type: 'match'
  data: {
    path: { text?: string }
    lines: { text?: string }
    line_number: number
    submatches: Array<{ match: { text: string }; start: number; end: number }>
  }
}

function buildArgs(query: string, options: SearchOptions): string[] {
  // We deliberately avoid --max-columns: with JSON output, rg omits line content
  // for over-long lines, leaving empty rows in the UI. CSS handles overflow.
  const args = ['--json', '--max-count=50']
  if (options.caseSensitive) args.push('--case-sensitive')
  else args.push('--smart-case')
  if (options.wholeWord) args.push('--word-regexp')
  if (!options.regex) args.push('--fixed-strings')
  for (const g of options.includeGlobs) if (g.trim()) args.push('-g', g.trim())
  for (const g of options.excludeGlobs) if (g.trim()) args.push('-g', `!${g.trim()}`)
  args.push('--', query, '.')
  return args
}

/**
 * Convert a UTF-8 byte offset into a JavaScript string (UTF-16 code unit) offset.
 * rg emits byte offsets in its JSON; JS string.slice() uses UTF-16 units, so
 * without this conversion multi-byte chars (CJK, emoji, accented Latin) would
 * highlight the wrong slice of the line.
 */
function byteToCharOffset(lineText: string, byteOffset: number): number {
  if (byteOffset <= 0) return 0
  const buf = Buffer.from(lineText, 'utf-8')
  if (byteOffset >= buf.length) return lineText.length
  return buf.subarray(0, byteOffset).toString('utf-8').length
}

function classifyStderr(stderr: string): { code: 'INVALID_REGEX' | 'INVALID_GLOB' | 'OTHER'; message: string } {
  const firstLine = stderr.trim().split('\n')[0] ?? ''
  if (/regex parse error/i.test(stderr)) return { code: 'INVALID_REGEX', message: firstLine }
  if (/error parsing glob|invalid glob|unrecognized escape/i.test(stderr))
    return { code: 'INVALID_GLOB', message: firstLine }
  return { code: 'OTHER', message: firstLine }
}

class SearchService {
  async searchContent(
    worktreePath: string,
    query: string,
    options: SearchOptions,
  ): Promise<SearchResult> {
    const started = Date.now()
    const maxResults = options.maxResults > 0 ? options.maxResults : DEFAULT_MAX_RESULTS
    const emptyResult: SearchResult = {
      files: [],
      totalMatches: 0,
      truncated: false,
      elapsedMs: 0,
    }
    if (!query) return { ...emptyResult, elapsedMs: Date.now() - started }

    // Guard against a worktree that was deleted or moved — ENOENT from the
    // spawn's cwd otherwise looks indistinguishable from a missing rg binary.
    if (!worktreePath || !existsSync(worktreePath) || !statSync(worktreePath).isDirectory()) {
      return {
        ...emptyResult,
        elapsedMs: Date.now() - started,
        error: { code: 'SPAWN_FAILED', message: `worktree path not accessible: ${worktreePath}` },
      }
    }

    // Ensure PATH probe has completed — without this, a system `rg` installed
    // via Homebrew is invisible when the app is launched from Finder (the
    // user's shell PATH is not inherited). This only matters for the fallback
    // path; the bundled binary is found via absolute path.
    await waitForEnrichedEnv()

    // Prefer the ripgrep binary that already ships with the Claude Agent SDK.
    // This matches the approach VSCode and Cursor take (they bundle their own
    // rg) so users never need to install ripgrep themselves. Falls back to
    // system `rg` only if the bundled binary can't be located.
    const rgBinary = BUNDLED_RG_PATH ?? 'rg'

    return new Promise((resolve) => {
      const args = buildArgs(query, options)
      const child = spawn(rgBinary, args, { cwd: worktreePath, env: enrichedEnv() })
      const byPath = new Map<string, SearchFileResult>()
      let totalMatches = 0
      let truncated = false
      let stderr = ''
      let stdoutBuf = ''

      const handleLine = (line: string) => {
        if (!line || truncated) return
        let parsed: RgMatchJson | { type: string }
        try {
          parsed = JSON.parse(line)
        } catch {
          return
        }
        if (parsed.type !== 'match') return
        const m = parsed as RgMatchJson
        const absPath = m.data.path.text
        if (!absPath) return
        const rawLine = m.data.lines.text
        // rg emits `bytes` (base64) instead of `text` for non-UTF8 / binary
        // content — skip these rather than display garbage.
        if (typeof rawLine !== 'string') return
        const lineText = rawLine.replace(/\r?\n$/, '')
        const rel = relative(worktreePath, absPath) || absPath
        let fileResult = byPath.get(absPath)
        if (!fileResult) {
          fileResult = { path: absPath, relativePath: rel, matches: [] }
          byPath.set(absPath, fileResult)
        }
        for (const sub of m.data.submatches) {
          if (totalMatches >= maxResults) {
            truncated = true
            break
          }
          // Convert rg's byte offsets to JS string offsets for correct slicing
          // in the renderer (multi-byte-safe for CJK / emoji).
          const charStart = byteToCharOffset(lineText, sub.start)
          const charEnd = byteToCharOffset(lineText, sub.end)
          fileResult.matches.push({
            lineNumber: m.data.line_number,
            lineText,
            matchStart: charStart,
            matchEnd: charEnd,
          })
          totalMatches++
        }
        if (truncated) child.kill('SIGTERM')
      }

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutBuf += chunk.toString('utf8')
        let idx: number
        while ((idx = stdoutBuf.indexOf('\n')) !== -1) {
          const line = stdoutBuf.slice(0, idx)
          stdoutBuf = stdoutBuf.slice(idx + 1)
          handleLine(line)
        }
      })

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8')
      })

      child.on('error', (err: NodeJS.ErrnoException) => {
        // ENOENT on spawn means the rg binary couldn't be found. We always
        // ship a bundled rg via the Claude Agent SDK vendor dir, so this
        // should be unreachable in practice — but if someone's running an
        // environment where that lookup failed and PATH has no rg either,
        // this is the one we'll hit.
        if (err.code === 'ENOENT') {
          const usingBundled = rgBinary !== 'rg'
          const message = usingBundled
            ? `bundled ripgrep not found at ${rgBinary}`
            : 'ripgrep (rg) could not be located'
          resolve({
            ...emptyResult,
            elapsedMs: Date.now() - started,
            error: { code: 'RG_MISSING', message },
          })
          return
        }
        logger.error('[Search] spawn error', err)
        resolve({
          ...emptyResult,
          elapsedMs: Date.now() - started,
          error: { code: 'SPAWN_FAILED', message: err.message },
        })
      })

      child.on('close', (code) => {
        if (stdoutBuf) handleLine(stdoutBuf)
        // rg exits 0 with matches, 1 without matches, 2 on error. Exit 2 with
        // no stderr happens when we SIGTERM for truncation — treat as success.
        if (code === 2 && stderr && !truncated) {
          const classified = classifyStderr(stderr)
          if (classified.code === 'INVALID_REGEX') {
            resolve({
              ...emptyResult,
              elapsedMs: Date.now() - started,
              error: { code: 'INVALID_REGEX', message: classified.message },
            })
            return
          }
          if (classified.code === 'INVALID_GLOB') {
            resolve({
              ...emptyResult,
              elapsedMs: Date.now() - started,
              error: { code: 'INVALID_GLOB', message: classified.message },
            })
            return
          }
          // Other rg error — surface it so the user sees the real cause.
          resolve({
            ...emptyResult,
            elapsedMs: Date.now() - started,
            error: { code: 'SPAWN_FAILED', message: classified.message || 'search failed' },
          })
          return
        }
        const files = Array.from(byPath.values()).sort((a, b) =>
          a.relativePath.localeCompare(b.relativePath),
        )
        resolve({
          files,
          totalMatches,
          truncated,
          elapsedMs: Date.now() - started,
        })
      })
    })
  }

  async replaceInFile(
    worktreePath: string,
    relativePath: string,
    matches: SearchMatch[],
    replacement: string,
  ): Promise<{ replaced: number }> {
    if (matches.length === 0) return { replaced: 0 }
    const abs = join(worktreePath, relativePath)
    if (!existsSync(abs)) return { replaced: 0 }
    const content = readFileSync(abs, 'utf-8')
    const lines = content.split('\n')
    const hadTrailingNewline = content.endsWith('\n')

    // Group by line, apply in reverse column order per line.
    const byLine = new Map<number, SearchMatch[]>()
    for (const m of matches) {
      const list = byLine.get(m.lineNumber) ?? []
      list.push(m)
      byLine.set(m.lineNumber, list)
    }

    let replaced = 0
    for (const [lineNumber, ms] of byLine) {
      const idx = lineNumber - 1
      if (idx < 0 || idx >= lines.length) continue
      let line = lines[idx]
      const sorted = [...ms].sort((a, b) => b.matchStart - a.matchStart)
      for (const m of sorted) {
        if (m.matchEnd > line.length || m.matchStart < 0 || m.matchStart >= m.matchEnd) continue
        const current = line.slice(m.matchStart, m.matchEnd)
        // Safety: only replace when the current text matches what rg reported.
        // Skip silently if content shifted between search and replace.
        const expected = m.lineText.slice(m.matchStart, m.matchEnd)
        if (current !== expected) continue
        line = line.slice(0, m.matchStart) + replacement + line.slice(m.matchEnd)
        replaced++
      }
      lines[idx] = line
    }

    let nextContent = lines.join('\n')
    if (hadTrailingNewline && !nextContent.endsWith('\n')) nextContent += '\n'
    writeFileSync(abs, nextContent, 'utf-8')
    return { replaced }
  }

  async replaceAll(
    worktreePath: string,
    results: SearchFileResult[],
    replacement: string,
  ): Promise<ReplaceResult> {
    let filesChanged = 0
    let replaced = 0
    const failed: ReplaceResult['failed'] = []
    for (const file of results) {
      try {
        const { replaced: n } = await this.replaceInFile(
          worktreePath,
          file.relativePath,
          file.matches,
          replacement,
        )
        if (n > 0) {
          filesChanged++
          replaced += n
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        failed.push({ path: file.relativePath, message })
        logger.error(`[Search] replace failed for ${file.relativePath}`, err)
      }
    }
    return { filesChanged, replaced, failed }
  }
}

export const searchService = new SearchService()
