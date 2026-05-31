import { execFile } from 'child_process'
import { promisify } from 'util'
import { readFile } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { ServiceCache } from '../lib/serviceCache'
import { enrichedEnv, waitForEnrichedEnv } from '../lib/enrichedEnv'

const exec = promisify(execFile)

type JiraFieldMode = 'summary' | 'context'

const JIRA_SUMMARY_FIELDS = 'key,issuetype,summary,status,assignee'
const JIRA_CONTEXT_FIELDS = '*all'

export interface JiraIssue {
  key: string
  summary: string
  description: string | null
  acceptanceCriteria: string | null
  status: string
  statusCategory: 'new' | 'indeterminate' | 'done'
  type: string
  assignee: string | null
  priority: string | null
  labels: string[]
  components: string[]
  parent: JiraIssueReference | null
  epic: JiraIssueReference | null
  comments: JiraComment[]
  linkedIssues: JiraLinkedIssue[]
  attachments: JiraAttachment[]
  url: string
}

export interface JiraIssueReference {
  key: string
  summary: string
  url: string
}

export interface JiraComment {
  author: string | null
  body: string
  created: string | null
}

export interface JiraLinkedIssue {
  key: string
  summary: string
  status: string | null
  relationship: string
  url: string
}

export interface JiraAttachment {
  filename: string
  url: string
  author: string | null
  mimeType: string | null
  size: number | null
}

export interface JiraResult {
  available: boolean
  issues: JiraIssue[]
}

class JiraService {
  // Cached availability flag, reset by recheckAvailability() after install
  private _available: boolean | null = null

  // Base URL detection cache: undefined = not yet attempted
  private _baseUrlDetected = false
  private _detectedBaseUrl: string | null = null

  // Cache raw acli JSON by issue key — 5 min TTL.
  // We cache the raw data (not the parsed JiraIssue) so URL construction uses
  // the current overrideUrl/detectedUrl at read time, not stale values from cache time.
  private issueDataCache = new ServiceCache<Record<string, unknown> | null>(300_000)

  async isAvailable(): Promise<boolean> {
    if (this._available !== null) return this._available
    try {
      await waitForEnrichedEnv()
      await exec('which', ['acli'], { timeout: 3_000, env: enrichedEnv() })
      this._available = true
    } catch {
      this._available = false
    }
    return this._available
  }

  async recheckAvailability(): Promise<boolean> {
    this._available = null
    return this.isAvailable()
  }

  /**
   * Detect the Jira base URL from the jira-cli config file.
   * jira-cli (ankitpokhrel/jira-cli) stores `server: https://yoursite.atlassian.net`
   * at ~/.config/.jira/.config.yml — tried in priority order.
   */
  private async detectBaseUrl(): Promise<string | null> {
    const candidates = [
      join(homedir(), '.config', '.jira', '.config.yml'),
      join(homedir(), '.config', 'jira', '.config.yml'),
      join(homedir(), '.jira', '.config.yml'),
      join(homedir(), '.jira.yml'),
    ]

    for (const candidate of candidates) {
      try {
        const content = await readFile(candidate, 'utf8')
        // Match `server: https://company.atlassian.net` (with optional quotes)
        const match = content.match(/^server:\s*['"]?(https?:\/\/[^\s'"]+)['"]?\s*$/m)
        if (match?.[1]) return match[1].replace(/\/+$/, '')
      } catch {
        // File not found — try next candidate
      }
    }

    return null
  }

  private async getDetectedBaseUrl(): Promise<string | null> {
    if (!this._baseUrlDetected) {
      this._detectedBaseUrl = await this.detectBaseUrl()
      this._baseUrlDetected = true
    }
    return this._detectedBaseUrl
  }

  /**
   * @param overrideBaseUrl Optional URL from user settings — takes priority over everything.
   */
  async getIssuesForBranch(worktreePath: string, overrideBaseUrl?: string, forceRefresh?: boolean): Promise<JiraResult> {
    const available = await this.isAvailable()
    if (!available) return { available: false, issues: [] }

    const branch = await this.getBranchName(worktreePath)
    const keys = this.extractKeys(branch)
    if (keys.length === 0) return { available: true, issues: [] }

    // Detect now so it's ready, but don't merge yet — parseIssue applies priority.
    const detectedUrl = await this.getDetectedBaseUrl()
    const overrideUrl = overrideBaseUrl?.trim() || null

    const results = await Promise.allSettled(keys.map((k) => this.getIssue(k, overrideUrl, detectedUrl, forceRefresh, 'summary')))
    const issues = results
      .filter((r): r is PromiseFulfilledResult<JiraIssue | null> => r.status === 'fulfilled')
      .map((r) => r.value)
      .filter((i): i is JiraIssue => i !== null)

    return { available: true, issues }
  }

  private async getIssue(
    key: string,
    overrideUrl: string | null,
    detectedUrl: string | null,
    forceRefresh?: boolean,
    fieldMode: JiraFieldMode = 'summary'
  ): Promise<JiraIssue | null> {
    const upperKey = key.toUpperCase()
    const cacheKey = `${fieldMode}:${upperKey}`
    const fields = fieldMode === 'context' ? JIRA_CONTEXT_FIELDS : JIRA_SUMMARY_FIELDS
    const data = await this.issueDataCache.get(cacheKey, async () => {
      try {
        const { stdout } = await exec('acli', ['jira', 'workitem', 'view', upperKey, '--json', '--fields', fields], {
          timeout: 10_000,
          env: enrichedEnv()
        })
        return JSON.parse(stdout.trim()) as Record<string, unknown>
      } catch {
        return null
      }
    }, { forceRefresh })
    if (!data) return null
    return this.parseIssue(data, overrideUrl, detectedUrl)
  }

  private parseIssue(data: Record<string, unknown>, overrideUrl: string | null, detectedUrl: string | null): JiraIssue | null {
    const fields = data.fields as Record<string, unknown> | undefined
    if (!fields || !data.key) return null

    const key = data.key as string
    const summary = (fields.summary as string) ?? ''
    const statusObj = fields.status as Record<string, unknown> | undefined
    const status = (statusObj?.name as string) ?? 'Unknown'
    const statusCategoryKey =
      ((statusObj?.statusCategory as Record<string, unknown>)?.key as string) ?? 'new'
    const type = ((fields.issuetype as Record<string, unknown>)?.name as string) ?? ''
    const assigneeObj = fields.assignee as Record<string, unknown> | null | undefined
    const assignee = (assigneeObj?.displayName as string) ?? null
    const priority = getNamedValue(fields.priority, 'name')
    const labels = toStringArray(fields.labels)
    const components = toNamedArray(fields.components)

    // URL priority: 1) settings override  2) self field (ground truth from API)  3) jira-cli auto-detect
    const self = (data.self as string) ?? ''
    const selfBaseUrl = self.match(/^(https?:\/\/[^/]+)/)?.[1] ?? ''
    const baseUrl = overrideUrl || selfBaseUrl || detectedUrl || ''
    const url = baseUrl ? `${baseUrl}/browse/${key}` : ''

    const statusCategory: 'new' | 'indeterminate' | 'done' =
      statusCategoryKey === 'done'
        ? 'done'
        : statusCategoryKey === 'indeterminate'
          ? 'indeterminate'
          : 'new'

    const names = data.names as Record<string, unknown> | undefined
    const description = normalizeText(fields.description)
    const acceptanceCriteria = normalizeText(
      fields.acceptanceCriteria ?? fields.acceptance_criteria ?? findFieldByName(fields, names, [
        'acceptance criteria',
        'acceptance criterion',
        'acceptance requirements',
      ])
    )
    const parent = parseIssueReference(fields.parent, baseUrl)
    const epic = parseEpicReference(fields, names, baseUrl, parent)
    const comments = parseComments(fields.comment)
    const linkedIssues = parseLinkedIssues(fields.issuelinks, baseUrl)
    const attachments = parseAttachments(fields.attachment)

    return {
      key, summary, description, acceptanceCriteria, status, statusCategory, type, assignee,
      priority, labels, components, parent, epic, comments, linkedIssues, attachments, url
    }
  }

  /**
   * Fetch a single Jira issue by key (e.g. "PROJ-1234").
   * Returns null if acli is not installed, key is not found, or fetch fails.
   */
  async getIssueByKey(key: string, overrideBaseUrl?: string, forceRefresh?: boolean, includeContext?: boolean): Promise<JiraIssue | null> {
    const available = await this.isAvailable()
    if (!available) return null
    const detectedUrl = await this.getDetectedBaseUrl()
    const overrideUrl = overrideBaseUrl?.trim() || null
    return this.getIssue(key, overrideUrl, detectedUrl, forceRefresh, includeContext ? 'context' : 'summary')
  }

  invalidateCache(key?: string): void {
    if (key) {
      this.issueDataCache.invalidate(`summary:${key.toUpperCase()}`)
      this.issueDataCache.invalidate(`context:${key.toUpperCase()}`)
      return
    }
    this.issueDataCache.clear()
  }

  private async getBranchName(worktreePath: string): Promise<string> {
    try {
      const { stdout } = await exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: worktreePath,
        timeout: 3_000
      })
      return stdout.trim()
    } catch {
      return ''
    }
  }

  /** Extract Jira issue keys from a branch name (case-insensitive, e.g. proj-1234 → PROJ-1234).
   *  Project key must be 2–10 letters only (no digits), matching Jira's own validation rules. */
  private extractKeys(branchName: string): string[] {
    const upper = branchName.toUpperCase()
    const matches = upper.match(/\b[A-Z]{2,10}-\d+\b/g)
    return matches ? [...new Set(matches)] : []
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getNamedValue(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null
  const named = value[key]
  return typeof named === 'string' && named.trim() ? named.trim() : null
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim())
}

function toNamedArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => getNamedValue(item, 'name'))
    .filter((item): item is string => item !== null)
}

function normalizeText(value: unknown): string | null {
  const text = adfToText(value).replace(/\n{3,}/g, '\n\n').trim()
  return text || null
}

function adfToText(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(adfToText).filter(Boolean).join('\n')
  if (!isRecord(value)) return ''

  const type = typeof value.type === 'string' ? value.type : ''
  if (type === 'text') return typeof value.text === 'string' ? value.text : ''
  if (type === 'hardBreak') return '\n'
  if (type === 'emoji' && isRecord(value.attrs)) {
    return getString(value.attrs.text) || getString(value.attrs.shortName) || ''
  }
  if (type === 'mention' && isRecord(value.attrs)) {
    return getString(value.attrs.text) || getString(value.attrs.displayName) || ''
  }
  if ((type === 'inlineCard' || type === 'blockCard') && isRecord(value.attrs)) {
    return getString(value.attrs.url) || ''
  }

  const children = Array.isArray(value.content) ? value.content : []
  if (type === 'bulletList') {
    return children.map((child) => `- ${adfToText(child).trim()}`).filter((line) => line.length > 2).join('\n')
  }
  if (type === 'orderedList') {
    return children.map((child, index) => `${index + 1}. ${adfToText(child).trim()}`).filter((line) => /\S/.test(line)).join('\n')
  }
  if (type === 'listItem') return children.map(adfToText).join('\n')
  if (type === 'paragraph' || type === 'heading' || type === 'blockquote' || type === 'codeBlock') {
    return children.map(adfToText).join('').trim()
  }
  if (type === 'table') return children.map(adfToText).filter(Boolean).join('\n')
  if (type === 'tableRow') return children.map(adfToText).filter(Boolean).join(' | ')
  if (type === 'tableCell' || type === 'tableHeader') return children.map(adfToText).join(' ').trim()

  return children.map(adfToText).filter(Boolean).join('\n')
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function findFieldByName(fields: Record<string, unknown>, names: Record<string, unknown> | undefined, targetNames: string[]): unknown {
  for (const [fieldKey, rawName] of Object.entries(names ?? {})) {
    if (typeof rawName !== 'string') continue
    const normalized = rawName.trim().toLowerCase()
    if (targetNames.some((target) => normalized === target || normalized.includes(target))) {
      return fields[fieldKey]
    }
  }
  return undefined
}

function parseIssueReference(value: unknown, baseUrl: string): JiraIssueReference | null {
  if (!isRecord(value)) return null
  const key = getString(value.key)
  if (!key) return null
  const fields = value.fields as Record<string, unknown> | undefined
  const summary = getString(fields?.summary) ?? ''
  const self = getString(value.self)
  const base = baseUrl || self?.match(/^(https?:\/\/[^/]+)/)?.[1] || ''
  return { key, summary, url: base ? `${base}/browse/${key}` : '' }
}

function parseEpicReference(
  fields: Record<string, unknown>,
  names: Record<string, unknown> | undefined,
  baseUrl: string,
  parent: JiraIssueReference | null
): JiraIssueReference | null {
  const parentType = ((fields.parent as Record<string, unknown> | undefined)?.fields as Record<string, unknown> | undefined)?.issuetype as Record<string, unknown> | undefined
  if (parent && getString(parentType?.name)?.toLowerCase() === 'epic') return parent

  const epicValue = fields.epic ?? findFieldByName(fields, names, ['epic link'])
  if (isRecord(epicValue)) return parseIssueReference(epicValue, baseUrl)
  const epicKey = getString(epicValue)
  if (!epicKey) return null
  return { key: epicKey, summary: '', url: baseUrl ? `${baseUrl}/browse/${epicKey}` : '' }
}

function parseComments(value: unknown): JiraComment[] {
  const rawComments = isRecord(value) && Array.isArray(value.comments)
    ? value.comments
    : Array.isArray(value)
      ? value
      : []

  return rawComments
    .map((comment): JiraComment | null => {
      if (!isRecord(comment)) return null
      const body = normalizeText(comment.body)
      if (!body) return null
      const author = getNamedValue(comment.author, 'displayName')
      const created = getString(comment.created)
      return { author, body, created }
    })
    .filter((comment): comment is JiraComment => comment !== null)
}

function parseLinkedIssues(value: unknown, baseUrl: string): JiraLinkedIssue[] {
  if (!Array.isArray(value)) return []
  return value
    .map((link): JiraLinkedIssue | null => {
      if (!isRecord(link)) return null
      const type = link.type as Record<string, unknown> | undefined
      const outwardIssue = link.outwardIssue
      const inwardIssue = link.inwardIssue
      const issue = isRecord(outwardIssue) ? outwardIssue : isRecord(inwardIssue) ? inwardIssue : null
      if (!issue) return null
      const key = getString(issue.key)
      if (!key) return null
      const issueFields = issue.fields as Record<string, unknown> | undefined
      const summary = getString(issueFields?.summary) ?? ''
      const status = getNamedValue(issueFields?.status, 'name')
      const relationship = isRecord(outwardIssue)
        ? getString(type?.outward) ?? getString(type?.name) ?? 'relates to'
        : getString(type?.inward) ?? getString(type?.name) ?? 'relates to'
      return {
        key,
        summary,
        status,
        relationship,
        url: baseUrl ? `${baseUrl}/browse/${key}` : '',
      }
    })
    .filter((issue): issue is JiraLinkedIssue => issue !== null)
}

function parseAttachments(value: unknown): JiraAttachment[] {
  if (!Array.isArray(value)) return []
  return value
    .map((attachment): JiraAttachment | null => {
      if (!isRecord(attachment)) return null
      const filename = getString(attachment.filename)
      if (!filename) return null
      const size = typeof attachment.size === 'number' ? attachment.size : null
      return {
        filename,
        url: getString(attachment.content) ?? '',
        author: getNamedValue(attachment.author, 'displayName'),
        mimeType: getString(attachment.mimeType),
        size,
      }
    })
    .filter((attachment): attachment is JiraAttachment => attachment !== null)
}

export const jiraService = new JiraService()
