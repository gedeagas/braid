import type { TFunction } from 'i18next'
import type { Project } from '@/types'
import { stripRepoQualifiers, tokenizeSearchQuery } from '@shared/task-query'
import { FILTER_SUGGESTIONS, PRESETS } from './constants'
import type {
  CheckRun,
  DiffLine,
  FilterSuggestion,
  GitHubPrFile,
  PrReview,
  GitHubWorkItem,
  QueryTokenRange,
  QuickFilter,
  RepoFilterOption,
} from './types'

type TasksT = TFunction<'tasks'>

export function parsePatch(patch: string): DiffLine[] {
  if (!patch.trim()) return []
  const lines = patch.split('\n')
  const parsed: DiffLine[] = []
  let oldLine = 0
  let newLine = 0
  let hunkIndex = 0

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] ?? ''
    const hunkMatch = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/)
    if (hunkMatch) {
      oldLine = Number(hunkMatch[1])
      newLine = Number(hunkMatch[2])
      hunkIndex += 1
      parsed.push({ id: `hunk:${hunkIndex}:${index}`, kind: 'hunk', text: raw, oldLine: null, newLine: null })
      continue
    }
    if (raw.startsWith('\\')) {
      parsed.push({ id: `note:${hunkIndex}:${index}`, kind: 'note', text: raw, oldLine: null, newLine: null })
      continue
    }

    const marker = raw.charAt(0)
    const text = raw.slice(1)
    if (marker === '+') {
      parsed.push({ id: `add:${hunkIndex}:${newLine}:${index}`, kind: 'add', text, oldLine: null, newLine })
      newLine += 1
      continue
    }
    if (marker === '-') {
      parsed.push({ id: `delete:${hunkIndex}:${oldLine}:${index}`, kind: 'delete', text, oldLine, newLine: null })
      oldLine += 1
      continue
    }

    parsed.push({ id: `context:${hunkIndex}:${oldLine}:${newLine}:${index}`, kind: 'context', text: marker === ' ' ? text : raw, oldLine, newLine })
    oldLine += 1
    newLine += 1
  }

  return parsed
}

export function getDiffFileStatusLabel(file: GitHubPrFile, t?: TasksT): string {
  if (file.status === 'renamed' && file.previousPath) {
    return t ? t('files.renamedFrom', { path: file.previousPath }) : `renamed from ${file.previousPath}`
  }
  return formatState(file.status, t)
}

export function formatFileSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return '0 B'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

export function isLikelyPreviewFile(file: GitHubPrFile): boolean {
  if (file.isBinary || !file.patch) return true
  const ext = file.path.split('.').pop()?.toLowerCase()
  return Boolean(ext && ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif'].includes(ext))
}

export function getRepoMarkerColor(project: Project): string {
  let hash = 0
  const key = project.id || project.name || project.path
  for (let i = 0; i < key.length; i += 1) hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0
  return `hsl(${Math.abs(hash) % 360} 64% 54%)`
}

export function isSshRemote(project: Project): boolean {
  const remote = project.settings?.remoteOrigin?.trim()
  return Boolean(remote && (/^(git@|ssh:)/i.test(remote) || remote.startsWith('ssh://')))
}

export function getCurrentTokenRange(query: string, cursor: number): QueryTokenRange {
  const safeCursor = Math.min(Math.max(cursor, 0), query.length)
  let start = safeCursor
  while (start > 0 && !/\s/.test(query[start - 1])) start -= 1
  let end = safeCursor
  while (end < query.length && !/\s/.test(query[end])) end += 1
  return { start, end, value: query.slice(start, end) }
}

export function getProjectBasename(project: Project): string {
  return project.path.replace(/\/+$/, '').split('/').pop() ?? project.name
}

export function parseNameWithOwner(value?: string): string | null {
  const cleaned = value?.trim().replace(/\/+$/, '').replace(/\.git$/i, '')
  if (!cleaned) return null
  const githubMatch = cleaned.match(/github\.com[:/]([^/\s]+\/[^/\s]+)$/i)
  if (githubMatch?.[1]) return githubMatch[1].replace(/\.git$/i, '')
  if (/^[^/\s]+\/[^/\s]+$/.test(cleaned)) return cleaned
  return null
}

export function getProjectRepoAliases(project: Project): string[] {
  const nameWithOwner = parseNameWithOwner(project.settings?.remoteOrigin)
  return [
    project.name,
    getProjectBasename(project),
    project.path,
    project.settings?.remoteOrigin ?? '',
    nameWithOwner ?? '',
    nameWithOwner?.split('/').pop() ?? '',
  ].map((value) => value.trim().toLowerCase()).filter((value, index, values) => value && values.indexOf(value) === index)
}

export function getProjectRepoValue(project: Project): string {
  return parseNameWithOwner(project.settings?.remoteOrigin) ?? getProjectBasename(project)
}

export function buildRepoFilterOptions(projects: Project[]): RepoFilterOption[] {
  return projects.map((project) => ({
    value: `repo:${getProjectRepoValue(project)}`,
    description: project.name === getProjectRepoValue(project) ? project.path : project.name,
    aliases: getProjectRepoAliases(project),
  }))
}

export function projectMatchesRepoFilters(project: Project, repoFilters: string[]): boolean {
  if (repoFilters.length === 0) return true
  const aliases = getProjectRepoAliases(project)
  return repoFilters.some((filter) => {
    const normalized = filter.toLowerCase()
    return aliases.some((alias) => alias === normalized || alias.endsWith(`/${normalized}`) || alias.includes(normalized))
  })
}

export function resolveSelectedProjectIds(projects: Project[], selectedProjectIds: ReadonlySet<string> | null, repoFilters: string[]): Set<string> {
  const projectIds = new Set(projects.map((project) => project.id))
  const baseIds = selectedProjectIds === null ? projectIds : new Set(Array.from(selectedProjectIds).filter((id) => projectIds.has(id)))
  const nonEmptyBaseIds = baseIds.size > 0 ? baseIds : projectIds
  if (repoFilters.length === 0) return nonEmptyBaseIds
  return new Set(projects.filter((project) => nonEmptyBaseIds.has(project.id) && projectMatchesRepoFilters(project, repoFilters)).map((project) => project.id))
}

export function findFilterSuggestions(query: string, tokenRange: QueryTokenRange, repoOptions: RepoFilterOption[]): FilterSuggestion[] {
  const term = tokenRange.value.toLowerCase()
  const usedTokens = new Set(tokenizeSearchQuery(stripRepoQualifiers(query)).map((token) => token.toLowerCase()).filter((token) => token !== term))
  const repoTerm = term.startsWith('repo:') ? term.slice('repo:'.length) : term
  const repoSuggestions = repoOptions
    .filter((option) => term.startsWith('repo:') && (!repoTerm || option.value.toLowerCase().includes(term) || option.aliases.some((alias) => alias.includes(repoTerm))))
    .map((option) => ({ value: option.value, description: option.description, aliases: option.aliases }))
  const staticSuggestions = FILTER_SUGGESTIONS.filter((suggestion) => {
    const value = suggestion.value.toLowerCase()
    if (!suggestion.value.endsWith(':') && usedTokens.has(value)) return false
    if (!term) return true
    if (value.startsWith(term) || value.includes(term)) return true
    return suggestion.aliases?.some((alias) => alias.toLowerCase().includes(term)) ?? false
  })
  return (term.startsWith('repo:') ? repoSuggestions : staticSuggestions).slice(0, 8)
}

export function applyFilterSuggestion(query: string, tokenRange: QueryTokenRange, suggestion: FilterSuggestion): { query: string; cursor: number } {
  const before = query.slice(0, tokenRange.start)
  const after = query.slice(tokenRange.end).replace(/^\s+/, '')
  const insertion = suggestion.value.endsWith(':') ? suggestion.value : `${suggestion.value} `
  const nextQuery = `${before}${insertion}${after ? ' ' : ''}${after}`.replace(/^\s+/, '')
  return { query: nextQuery, cursor: Math.max(0, before.length + suggestion.value.length) }
}

export function removeQueryTokens(query: string, predicate: (token: string) => boolean): string {
  return tokenizeSearchQuery(query).filter((token) => !predicate(token.toLowerCase())).join(' ')
}

export function upsertQueryToken(query: string, token: QuickFilter): string {
  const normalized = token.toLowerCase()
  const next = removeQueryTokens(query, (current) => {
    if (normalized.startsWith('is:')) {
      if (normalized === 'is:pr' || normalized === 'is:issue') return current === 'is:pr' || current === 'is:pull-request' || current === 'is:issue'
      if (normalized === 'is:draft') return current === 'is:draft'
      return current === 'is:open' || current === 'is:closed' || current === 'is:merged' || current.startsWith('state:')
    }
    return current.startsWith(`${normalized.split(':')[0]}:`)
  })
  return `${token} ${next}`.trim()
}

export function getQuickFilterMatcher(key: string): (token: string) => boolean {
  return (token) => {
    if (key === 'scope') return token === 'is:pr' || token === 'is:pull-request' || token === 'is:issue'
    if (key === 'state') return token === 'is:open' || token === 'is:closed' || token === 'is:merged' || token.startsWith('state:')
    if (key === 'draft') return token === 'is:draft'
    if (key === 'reviewer') return token.startsWith('review-requested:') || token.startsWith('reviewed-by:')
    return token.startsWith(`${key}:`)
  }
}

export function stateVariant(item: GitHubWorkItem): 'success' | 'warning' | 'danger' | 'muted' | 'accent' {
  if (item.type === 'pr' && item.isDraft) return 'muted'
  if (item.state === 'open') return 'success'
  if (item.state === 'merged') return 'accent'
  return 'warning'
}

export function stateLabel(item: GitHubWorkItem, t?: TasksT): string {
  if (item.type === 'pr' && item.isDraft) return t ? t('status.draft') : 'Draft'
  if (item.state === 'merged') return t ? t('status.merged') : 'Merged'
  if (item.state === 'closed') return t ? t('status.closed') : 'Closed'
  return t ? t('status.open') : 'Open'
}

export function mergeVariant(mergeStateStatus?: string): 'success' | 'warning' | 'danger' | 'muted' {
  if (mergeStateStatus === 'CLEAN' || mergeStateStatus === 'HAS_HOOKS') return 'success'
  if (mergeStateStatus === 'BLOCKED' || mergeStateStatus === 'DIRTY') return 'danger'
  if (mergeStateStatus === 'BEHIND' || mergeStateStatus === 'UNSTABLE' || mergeStateStatus === 'UNKNOWN') return 'warning'
  return 'muted'
}

export function checkVariant(check: CheckRun): 'success' | 'warning' | 'danger' | 'muted' {
  const conclusion = check.conclusion?.toLowerCase()
  const status = check.status?.toLowerCase()
  if (conclusion === 'success' || conclusion === 'skipped') return 'success'
  if (conclusion === 'failure' || conclusion === 'cancelled' || conclusion === 'timed_out' || conclusion === 'action_required') return 'danger'
  if (status === 'queued' || status === 'in_progress' || !conclusion) return 'warning'
  return 'muted'
}

export function getCheckState(check: CheckRun): 'success' | 'failure' | 'pending' | 'skipped' {
  const conclusion = check.conclusion?.toLowerCase()
  if (conclusion === 'success') return 'success'
  if (conclusion === 'skipped') return 'skipped'
  if (conclusion === 'failure' || conclusion === 'cancelled' || conclusion === 'timed_out' || conclusion === 'action_required') return 'failure'
  return 'pending'
}

export function getCheckDuration(start?: string | null, end?: string | null): string | null {
  if (!start || !end) return null
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (!Number.isFinite(ms) || ms <= 0) return null
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  return `${Math.round(minutes / 60)}h`
}

export function getCheckStateLabel(check: CheckRun, t?: TasksT): string {
  const state = getCheckState(check)
  if (state === 'pending') return t ? t('status.in_progress') : 'In progress'
  if (state === 'skipped') return t ? t('status.skipped') : 'Skipped'
  if (state === 'success') return t ? t('status.success') : 'Success'
  return formatState(check.conclusion ?? 'failure', t)
}

export function groupChecks(checks: CheckRun[]): Array<[string, CheckRun[]]> {
  const groups = new Map<string, CheckRun[]>()
  for (const check of checks) {
    const key = check.workflowName || check.name
    const list = groups.get(key) ?? []
    list.push(check)
    groups.set(key, list)
  }
  return Array.from(groups.entries())
}

export function reviewVariant(state: string): 'success' | 'warning' | 'danger' | 'muted' {
  if (state === 'APPROVED') return 'success'
  if (state === 'CHANGES_REQUESTED') return 'danger'
  if (state === 'PENDING' || state === 'REVIEW_REQUIRED') return 'warning'
  return 'muted'
}

export function shouldShowReviewTimelineEntry(review: PrReview): boolean {
  if (review.body.trim().length > 0) return true
  return review.state !== 'COMMENTED'
}

export function formatState(value?: string, t?: TasksT): string {
  if (!value) return t ? t('status.no_status') : 'No status'
  const normalized = value.toLowerCase()
  const fallback = normalized.replaceAll('_', ' ').replace(/\b\w/g, (m) => m.toUpperCase())
  return t ? t(`status.${normalized}`, { defaultValue: fallback }) : fallback
}

export function formatSignedCount(value: number, prefix: string): string {
  return `${prefix}${Math.max(0, value).toLocaleString()}`
}

export function getPresetId(query: string): string | null {
  return PRESETS.find((preset) => preset.query === query.trim())?.id ?? null
}
