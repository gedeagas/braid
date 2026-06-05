import type { ParsedTaskQuery } from '../../../shared/task-query'
import type {
  CheckRun,
  GitHubLabel,
  GitHubPrDetailItem,
  GitHubPrFile,
  GitHubReactionContent,
  GitHubReactionGroup,
  GitHubWorkItem,
  GitHubWorkItemState,
  PrIssueComment,
  PrReviewComment,
} from './types'

export function getString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function getLogin(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  return getString((value as Record<string, unknown>).login)
}

export function getLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((label) => getString((label as Record<string, unknown>)?.name)).filter(Boolean)
}

export function normalizeLabelColor(value: unknown): string {
  const color = getString(value).trim().replace(/^#/, '')
  return /^[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : '6e7781'
}

export function mapGitHubLabel(value: unknown): GitHubLabel | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const name = getString(record.name).trim()
  if (!name) return null
  const description = getString(record.description).trim()
  return {
    name,
    color: normalizeLabelColor(record.color),
    description: description || null,
  }
}

export function getLabelDetails(value: unknown): GitHubLabel[] {
  if (!Array.isArray(value)) return []
  return value.map(mapGitHubLabel).filter((label): label is GitHubLabel => Boolean(label))
}

export function getAssignees(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((assignee) => getLogin(assignee)).filter(Boolean)
}

export function getReviewRequests(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((request) => {
      if (!request || typeof request !== 'object') return ''
      const record = request as Record<string, unknown>
      return getLogin(record.requestedReviewer) || getLogin(record)
    })
    .filter(Boolean)
}

export function getAuthorLogin(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const record = value as Record<string, unknown>
  return getString(record.login)
}

export function getAuthorAvatarUrl(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const record = value as Record<string, unknown>
  return getString(record.avatarUrl) || getString(record.avatar_url)
}

export function getAuthorIsBot(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return record.__typename === 'Bot' || record.type === 'Bot'
}

export function mapReactionGroups(value: unknown): GitHubReactionGroup[] {
  if (!Array.isArray(value)) return []
  return value.map((group) => {
    const record = group as Record<string, unknown>
    const reactors = record.reactors as Record<string, unknown> | undefined
    return {
      content: getString(record.content) as GitHubReactionContent,
      count: Number(reactors?.totalCount) || 0,
      viewerHasReacted: record.viewerHasReacted === true,
    }
  }).filter((group) => group.content && group.count > 0)
}

export function normalizeWorkItemState(value: unknown): GitHubWorkItemState {
  const state = getString(value).toUpperCase()
  if (state === 'MERGED') return 'merged'
  if (state === 'CLOSED') return 'closed'
  return 'open'
}

export function mapIssueWorkItem(item: Record<string, unknown>): GitHubWorkItem {
  const number = Number(item.number) || 0
  return {
    id: `issue:${number}`,
    type: 'issue',
    number,
    title: getString(item.title),
    state: normalizeWorkItemState(item.state),
    url: getString(item.url),
    author: getLogin(item.author),
    labels: getLabels(item.labels),
    assignees: getAssignees(item.assignees),
    updatedAt: getString(item.updatedAt),
  }
}

export function mapPrWorkItem(item: Record<string, unknown>): GitHubWorkItem {
  const number = Number(item.number) || 0
  return {
    id: `pr:${number}`,
    type: 'pr',
    number,
    title: getString(item.title),
    state: normalizeWorkItemState(item.state),
    url: getString(item.url),
    author: getLogin(item.author),
    labels: getLabels(item.labels),
    assignees: getAssignees(item.assignees),
    updatedAt: getString(item.updatedAt),
    isDraft: item.isDraft === true,
    headBranch: getString(item.headRefName),
    baseBranch: getString(item.baseRefName),
    mergeable: getString(item.mergeable),
    reviewDecision: getString(item.reviewDecision),
    mergeStateStatus: getString(item.mergeStateStatus),
  }
}

export function mapPrDetailItem(item: Record<string, unknown>, repoNameWithOwner: string): GitHubPrDetailItem {
  const mapped = mapPrWorkItem(item)
  return {
    ...mapped,
    body: getString(item.body),
    createdAt: getString(item.createdAt),
    pullRequestId: getString(item.pullRequestId),
    headRefOid: getString(item.headRefOid),
    additions: Number(item.additions) || 0,
    deletions: Number(item.deletions) || 0,
    changedFiles: Number(item.changedFiles) || 0,
    commitsCount: Array.isArray(item.commits) ? item.commits.length : 0,
    repoNameWithOwner,
    reviewRequests: getReviewRequests(item.reviewRequests),
    labelDetails: getLabelDetails(item.labels),
  }
}

export function mapPrFile(file: Record<string, unknown>, viewedStates = new Map<string, GitHubPrFile['viewedState']>()): GitHubPrFile {
  const patch = getString(file.patch)
  const path = getString(file.filename)
  return {
    path,
    previousPath: getString(file.previous_filename) || null,
    status: getString(file.status),
    viewedState: viewedStates.get(path) ?? null,
    additions: Number(file.additions) || 0,
    deletions: Number(file.deletions) || 0,
    changes: Number(file.changes) || 0,
    patch,
    isBinary: !patch && Number(file.changes) > 0,
  }
}

export function mapPrIssueComment(comment: Record<string, unknown>): PrIssueComment {
  const user = comment.user as Record<string, unknown> | undefined
  return {
    id: Number(comment.id) || 0,
    subjectId: getString(comment.node_id) || getString(comment.id),
    author: getLogin(user),
    authorAvatarUrl: getString(user?.avatar_url),
    isBot: getAuthorIsBot(user),
    body: getString(comment.body),
    createdAt: getString(comment.created_at),
    updatedAt: getString(comment.updated_at),
    htmlUrl: getString(comment.html_url),
    reactions: mapReactionGroups(comment.reactionGroups),
  }
}

export function mapPrReviewComment(
  comment: Record<string, unknown>,
  threadData: Map<number, {
    threadId: string
    isResolved: boolean
    isOutdated: boolean
    line: number | null
    startLine: number | null
    reactions: GitHubReactionGroup[]
    subjectId: string
    author?: string
    authorAvatarUrl?: string
    isBot?: boolean
    body?: string
    createdAt?: string
    htmlUrl?: string
  }>
): PrReviewComment {
  const commentId = Number(comment.id) || 0
  const replyTo = (comment.in_reply_to_id as number) ?? null
  const user = comment.user as Record<string, unknown> | undefined
  const thread = threadData.get(commentId)
  return {
    id: commentId,
    subjectId: thread?.subjectId || getString(comment.node_id) || getString(comment.id),
    reviewId: Number(comment.pull_request_review_id) || 0,
    author: thread?.author || getLogin(user) || 'unknown',
    authorAvatarUrl: thread?.authorAvatarUrl || getString(user?.avatar_url),
    isBot: thread?.isBot ?? getAuthorIsBot(user),
    body: thread?.body ?? getString(comment.body),
    path: getString(comment.path),
    line: thread?.line ?? (comment.line as number) ?? (comment.original_line as number) ?? null,
    startLine: thread?.startLine ?? null,
    originalLine: (comment.original_line as number) ?? null,
    side: (comment.side as 'LEFT' | 'RIGHT') ?? 'RIGHT',
    diffHunk: getString(comment.diff_hunk),
    createdAt: thread?.createdAt ?? getString(comment.created_at),
    updatedAt: getString(comment.updated_at),
    htmlUrl: thread?.htmlUrl ?? getString(comment.html_url),
    inReplyToId: replyTo,
    threadId: thread?.threadId ?? null,
    isResolved: thread?.isResolved ?? false,
    isOutdated: thread?.isOutdated ?? false,
    reactions: thread?.reactions ?? [],
  }
}

export function quoteGitHubSearchValue(value: string): string {
  return /\s/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value
}

export function buildSearchQueryString(nwo: string, query: ParsedTaskQuery): string {
  const parts = [`repo:${nwo}`]
  if (query.scope === 'pr') parts.push('is:pull-request')
  else if (query.scope === 'issue') parts.push('is:issue')

  if (query.state === 'open') parts.push('is:open')
  else if (query.state === 'closed') {
    parts.push('is:closed')
    if (query.scope !== 'issue') parts.push('-is:merged')
  } else if (query.state === 'merged') {
    parts.push('is:merged')
  }

  if (query.draft) parts.push('draft:true')
  if (query.assignee) parts.push(`assignee:${quoteGitHubSearchValue(query.assignee)}`)
  if (query.author) parts.push(`author:${quoteGitHubSearchValue(query.author)}`)
  if (query.reviewRequested) parts.push(`review-requested:${quoteGitHubSearchValue(query.reviewRequested)}`)
  if (query.reviewedBy) parts.push(`reviewed-by:${quoteGitHubSearchValue(query.reviewedBy)}`)
  for (const label of query.labels) parts.push(`label:${quoteGitHubSearchValue(label)}`)
  if (query.freeText) parts.push(query.freeText)
  return parts.join(' ')
}

export function encodeGitHubPath(path: string): string {
  return path.split('/').map((segment) => encodeURIComponent(segment)).join('/')
}

export function getMimeType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase()
  if (ext === 'png') return 'image/png'
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'svg') return 'image/svg+xml'
  if (ext === 'avif') return 'image/avif'
  if (ext === 'txt' || ext === 'md' || ext === 'json' || ext === 'js' || ext === 'ts' || ext === 'tsx' || ext === 'css') return 'text/plain'
  return 'application/octet-stream'
}

export function isImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith('image/')
}
