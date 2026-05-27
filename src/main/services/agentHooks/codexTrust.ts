import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { createHash, randomUUID } from 'crypto'
import { dirname, join } from 'path'

export type CodexEventLabel =
  | 'session_start'
  | 'user_prompt_submit'
  | 'pre_tool_use'
  | 'permission_request'
  | 'post_tool_use'
  | 'stop'

export interface CodexTrustEntry {
  sourcePath: string
  eventLabel: CodexEventLabel
  groupIndex: number
  handlerIndex: number
  command: string
}

interface CodexHookTrustState {
  enabled?: boolean
  trustedHash?: string
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key])
    }
    return out
  }
  return value
}

/** Match Codex's command_hook_hash identity for hooks.json command handlers. */
export function computeTrustedHash(entry: CodexTrustEntry): string {
  const identity = {
    event_name: entry.eventLabel,
    hooks: [{
      async: false,
      command: entry.command,
      timeout: 600,
      type: 'command',
    }],
  }
  const serialized = JSON.stringify(canonicalize(identity))
  return `sha256:${createHash('sha256').update(serialized).digest('hex')}`
}

export function getCodexCanonicalTrustPath(sourcePath: string): string {
  try {
    return realpathSync.native(sourcePath)
  } catch {
    return sourcePath
  }
}

export function computeTrustKey(entry: CodexTrustEntry): string {
  return `${getCodexCanonicalTrustPath(entry.sourcePath)}:${entry.eventLabel}:${entry.groupIndex}:${entry.handlerIndex}`
}

export function escapeTomlString(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\b', '\\b')
    .replaceAll('\f', '\\f')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\t', '\\t')
}

function unescapeTomlBasicString(value: string): string {
  return value.replace(/\\(["\\btnfrt])/g, (_match, ch: string) => {
    switch (ch) {
      case '"': return '"'
      case '\\': return '\\'
      case 'b': return '\b'
      case 't': return '\t'
      case 'n': return '\n'
      case 'f': return '\f'
      case 'r': return '\r'
      default: return ch
    }
  })
}

function readTomlFile(configPath: string): string {
  const raw = readFileSync(configPath, 'utf-8')
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
}

export function readHookTrustEntries(configPath: string): Map<string, CodexHookTrustState> {
  const entries = new Map<string, CodexHookTrustState>()
  if (!existsSync(configPath)) return entries

  let currentKey: string | null = null
  for (const line of readTomlFile(configPath).split(/\r?\n/)) {
    const header = /^\s*\[hooks\.state\."((?:\\.|[^"\\])*)"\]\s*(?:#.*)?$/.exec(line)
    if (header) {
      currentKey = unescapeTomlBasicString(header[1])
      entries.set(currentKey, entries.get(currentKey) ?? {})
      continue
    }
    if (/^\s*\[/.test(line)) {
      currentKey = null
      continue
    }
    if (!currentKey) continue

    const enabled = /^\s*enabled\s*=\s*(true|false)\s*(?:#.*)?$/.exec(line)
    if (enabled) {
      entries.get(currentKey)!.enabled = enabled[1] === 'true'
      continue
    }
    const trustedHash = /^\s*trusted_hash\s*=\s*"([^"]*)"\s*(?:#.*)?$/.exec(line)
    if (trustedHash) {
      entries.get(currentKey)!.trustedHash = trustedHash[1]
    }
  }

  return entries
}

function buildTrustBlock(key: string, hash: string, enabled: boolean): string {
  return [
    `[hooks.state."${escapeTomlString(key)}"]`,
    `enabled = ${enabled}`,
    `trusted_hash = "${escapeTomlString(hash)}"`,
  ].join('\n')
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildHeaderPattern(key: string): RegExp {
  const escapedKey = escapeRegex(escapeTomlString(key))
  return new RegExp(`(^|\\r?\\n)[ \\t]*\\[hooks\\.state\\."${escapedKey}"\\][ \\t]*(?:#[^\\r\\n]*)?(?=\\r?\\n|$)`)
}

function findNextTableHeader(text: string): number {
  const match = /(?:^|\n)[ \t]*\[/.exec(text)
  return match ? match.index + (match[0].startsWith('\n') ? 1 : 0) : -1
}

function upsertTrustBlock(content: string, key: string, hash: string): string {
  const match = buildHeaderPattern(key).exec(content)
  if (!match) {
    const block = buildTrustBlock(key, hash, true)
    if (!content) return `${block}\n`
    const separator = content.endsWith('\n\n') ? '' : content.endsWith('\n') ? '\n' : '\n\n'
    return `${content}${separator}${block}\n`
  }

  const headerStart = match.index + (match[1] ? match[1].length : 0)
  const headerLineEnd = match.index + match[0].length
  const after = content.slice(headerLineEnd)
  const nextHeaderRel = findNextTableHeader(after)
  const blockEnd = nextHeaderRel === -1 ? content.length : headerLineEnd + nextHeaderRel
  const existingBlock = content.slice(headerLineEnd, blockEnd)
  const enabledMatch = /^[ \t]*enabled[ \t]*=[ \t]*(true|false)[ \t\r]*(?:#.*)?$/m.exec(existingBlock)
  const enabled = enabledMatch ? enabledMatch[1] === 'true' : true
  return `${content.slice(0, headerStart)}${buildTrustBlock(key, hash, enabled)}\n${content.slice(blockEnd)}`
}

function removeTrustBlock(content: string, key: string): string {
  const match = buildHeaderPattern(key).exec(content)
  if (!match) return content

  const cutStart = match.index + (match[1] ? match[1].length : 0)
  const headerLineEnd = match.index + match[0].length
  const after = content.slice(headerLineEnd)
  const nextHeaderRel = findNextTableHeader(after)
  const cutEnd = nextHeaderRel === -1 ? content.length : headerLineEnd + nextHeaderRel
  return content.slice(0, cutStart) + content.slice(cutEnd)
}

function writeConfigAtomically(configPath: string, contents: string): void {
  let targetPath = configPath
  if (existsSync(configPath)) {
    try {
      targetPath = realpathSync.native(configPath)
    } catch {
      targetPath = configPath
    }
  }

  const dir = dirname(targetPath)
  mkdirSync(dir, { recursive: true })
  const tmpPath = join(dir, `.${Date.now()}-${randomUUID()}.tmp`)
  let renamed = false
  try {
    writeFileSync(tmpPath, contents, { encoding: 'utf-8', mode: 0o600 })
    renameSync(tmpPath, targetPath)
    renamed = true
  } finally {
    if (!renamed) {
      try { unlinkSync(tmpPath) } catch {}
    }
  }
}

export function upsertHookTrustEntries(configPath: string, entries: readonly CodexTrustEntry[]): void {
  const existing = existsSync(configPath) ? readTomlFile(configPath) : ''
  let updated = existing
  for (const entry of entries) {
    updated = upsertTrustBlock(updated, computeTrustKey(entry), computeTrustedHash(entry))
  }
  if (updated !== existing) writeConfigAtomically(configPath, updated)
}

export function removeHookTrustEntries(configPath: string, entries: readonly CodexTrustEntry[]): void {
  if (!existsSync(configPath)) return
  const existing = readTomlFile(configPath)
  let updated = existing
  for (const entry of entries) {
    updated = removeTrustBlock(updated, computeTrustKey(entry))
  }
  if (updated !== existing) writeConfigAtomically(configPath, updated)
}

export function hasHookTrustEntries(configPath: string, entries: readonly CodexTrustEntry[]): boolean {
  const existing = readHookTrustEntries(configPath)
  return entries.every((entry) => {
    const state = existing.get(computeTrustKey(entry))
    return state?.trustedHash === computeTrustedHash(entry) && state.enabled !== false
  })
}
