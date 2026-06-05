import { parseTaskQuery, type ParsedTaskQuery } from "../../../shared/task-query"
import { GitHubCore, resolveNwo } from "./core"
import {
  PR_DETAIL_JSON_FIELDS,
  WORK_ITEM_ISSUE_LIST_JSON_FIELDS,
  WORK_ITEM_PR_LIST_JSON_FIELDS,
  type CheckRun,
  type GitHubLabelSuggestion,
  type GitHubPrDetail,
  type GitHubPrFile,
  type GitHubPrFilePreview,
  type GitHubReactionContent,
  type GitHubReviewerSuggestion,
  type GitHubWorkItem,
  type GitHubWorkItemType,
  type ListWorkItemsResult,
  type PrGraphqlMetadata,
  type PrIssueComment,
  type PrReviewComment,
  type PrReviewData,
} from "./types"
import {
  buildSearchQueryString,
  encodeGitHubPath,
  getMimeType,
  getString,
  isImageMimeType,
  mapGitHubLabel,
  mapIssueWorkItem,
  mapPrDetailItem,
  mapPrIssueComment,
  mapPrReviewComment,
  mapPrWorkItem,
} from "./mappers"

export abstract class GitHubTasks extends GitHubCore {
  protected abstract _fetchChecksForPr(repoPath: string, nwo: string, prNumber: number): Promise<CheckRun[]>
  protected abstract _fetchReviewsForPr(repoPath: string, nwo: string, prNumber: number, threadData?: PrGraphqlMetadata["reviewCommentThreads"]): Promise<PrReviewData>
  protected abstract _fetchIssueCommentsForPr(repoPath: string, nwo: string, prNumber: number): Promise<PrIssueComment[]>
  protected abstract _fetchFilesForPr(repoPath: string, nwo: string, prNumber: number, viewedStates?: Map<string, GitHubPrFile["viewedState"]>): Promise<GitHubPrFile[]>
  protected abstract _fetchPrGraphqlMetadata(repoPath: string, nwo: string, prNumber: number): Promise<PrGraphqlMetadata>
  async listWorkItems(repoPath: string, limit = 50, query = 'author:@me is:pr is:open', forceRefresh?: boolean): Promise<ListWorkItemsResult> {
    const normalizedLimit = Math.max(1, Math.min(100, Math.round(limit || 50)))
    const normalizedQuery = query.trim() || 'author:@me is:pr is:open'
    const key = `${repoPath}::${normalizedLimit}::${normalizedQuery}`
    return this.workItemsCache.get(
      key,
      () => this._fetchWorkItems(repoPath, normalizedLimit, normalizedQuery),
      { forceRefresh }
    )
  }

  async countWorkItems(repoPath: string, query = 'author:@me is:pr is:open', forceRefresh?: boolean): Promise<number> {
    const normalizedQuery = query.trim() || 'author:@me is:pr is:open'
    const key = `${repoPath}::count::${normalizedQuery}`
    return this.workItemCountsCache.get(
      key,
      () => this._fetchWorkItemCount(repoPath, normalizedQuery),
      { forceRefresh }
    )
  }

  async getPrDetail(repoPath: string, number: number, forceRefresh?: boolean): Promise<GitHubPrDetail> {
    const normalizedNumber = Math.max(1, Math.round(number || 0))
    const key = `${repoPath}::pr-detail::${normalizedNumber}`
    return this.prDetailCache.get(
      key,
      () => this._fetchPrDetail(repoPath, normalizedNumber),
      { forceRefresh }
    )
  }

  async listReviewerSuggestions(repoPath: string, query = '', limit = 8, forceRefresh?: boolean): Promise<GitHubReviewerSuggestion[]> {
    const normalizedQuery = query.trim().replace(/^@+/, '')
    const normalizedLimit = Math.max(1, Math.min(20, Math.round(limit || 8)))
    const cacheKey = `${repoPath}::reviewer-suggestions::${normalizedQuery.toLowerCase()}::${normalizedLimit}`
    return this.reviewerSuggestionsCache.get(
      cacheKey,
      () => this._fetchReviewerSuggestions(repoPath, normalizedQuery, normalizedLimit),
      { forceRefresh }
    )
  }

  async listLabelSuggestions(repoPath: string, query = '', limit = 20, forceRefresh?: boolean): Promise<GitHubLabelSuggestion[]> {
    const normalizedQuery = query.trim()
    const normalizedLimit = Math.max(1, Math.min(50, Math.round(limit || 20)))
    const cacheKey = `${repoPath}::label-suggestions::${normalizedQuery.toLowerCase()}::${normalizedLimit}`
    return this.labelSuggestionsCache.get(
      cacheKey,
      () => this._fetchLabelSuggestions(repoPath, normalizedQuery, normalizedLimit),
      { forceRefresh }
    )
  }

  protected async _fetchLabelSuggestions(repoPath: string, query: string, limit: number): Promise<GitHubLabelSuggestion[]> {
    await this.assertRateLimitBudget(repoPath, 'graphql', 10)
    const nwo = await resolveNwo(repoPath)
    const [owner, name] = nwo.split('/')
    if (!owner || !name) throw new Error('Could not resolve repository owner and name')

    const graphql = `
      query($owner: String!, $name: String!, $searchQuery: String!, $first: Int!) {
        repository(owner: $owner, name: $name) {
          labels(first: $first, query: $searchQuery, orderBy: { field: NAME, direction: ASC }) {
            nodes {
              name
              color
              description
            }
          }
        }
      }
    `
    const raw = await this.gh(
      ['api', 'graphql', '-f', `query=${graphql}`, '-f', `owner=${owner}`, '-f', `name=${name}`, '-f', `searchQuery=${query}`, '-F', `first=${limit}`],
      repoPath,
      true
    )
    const data = JSON.parse(raw || '{}') as {
      data?: {
        repository?: {
          labels?: {
            nodes?: Array<Record<string, unknown> | null>
          }
        }
      }
    }
    const seen = new Set<string>()
    const suggestions: GitHubLabelSuggestion[] = []
    for (const node of data.data?.repository?.labels?.nodes ?? []) {
      const label = mapGitHubLabel(node)
      if (!label || seen.has(label.name.toLowerCase())) continue
      seen.add(label.name.toLowerCase())
      suggestions.push(label)
    }
    return suggestions
  }

  protected async _fetchReviewerSuggestions(repoPath: string, query: string, limit: number): Promise<GitHubReviewerSuggestion[]> {
    await this.assertRateLimitBudget(repoPath, 'graphql', 10)
    const nwo = await resolveNwo(repoPath)
    const [owner, name] = nwo.split('/')
    if (!owner || !name) throw new Error('Could not resolve repository owner and name')

    const graphql = `
      query($owner: String!, $name: String!, $searchQuery: String!, $first: Int!) {
        repository(owner: $owner, name: $name) {
          assignableUsers(first: $first, query: $searchQuery) {
            nodes {
              login
              name
              avatarUrl
            }
          }
        }
      }
    `
    const raw = await this.gh(
      ['api', 'graphql', '-f', `query=${graphql}`, '-f', `owner=${owner}`, '-f', `name=${name}`, '-f', `searchQuery=${query}`, '-F', `first=${limit}`],
      repoPath,
      true
    )
    const data = JSON.parse(raw || '{}') as {
      data?: {
        repository?: {
          assignableUsers?: {
            nodes?: Array<Record<string, unknown> | null>
          }
        }
      }
    }
    const seen = new Set<string>()
    const suggestions: GitHubReviewerSuggestion[] = []
    for (const node of data.data?.repository?.assignableUsers?.nodes ?? []) {
      if (!node) continue
      const login = getString(node.login).trim()
      if (!login || seen.has(login.toLowerCase())) continue
      seen.add(login.toLowerCase())
      suggestions.push({
        login,
        name: getString(node.name).trim() || null,
        avatarUrl: getString(node.avatarUrl),
      })
    }
    return suggestions
  }

  protected async _fetchPrDetail(repoPath: string, number: number): Promise<GitHubPrDetail> {
    const nwo = await resolveNwo(repoPath)
    const raw = await this.gh(
      ['pr', 'view', String(number), '--repo', nwo, '--json', PR_DETAIL_JSON_FIELDS],
      repoPath,
      true
    )
    const data = JSON.parse(raw || '{}') as Record<string, unknown>
    const graphqlMetadata = await this._fetchPrGraphqlMetadata(repoPath, nwo, number)
    const [checks, reviews, restIssueComments, files] = await Promise.all([
      this._fetchChecksForPr(repoPath, nwo, number),
      this._fetchReviewsForPr(repoPath, nwo, number, graphqlMetadata.reviewCommentThreads),
      this._fetchIssueCommentsForPr(repoPath, nwo, number),
      this._fetchFilesForPr(repoPath, nwo, number, graphqlMetadata.viewedStates),
    ])
    const item = mapPrDetailItem(data, nwo)
    return {
      item: { ...item, pullRequestId: graphqlMetadata.pullRequestId },
      checks,
      reviews: reviews.reviews,
      issueComments: graphqlMetadata.issueComments.length > 0 ? graphqlMetadata.issueComments : restIssueComments,
      comments: reviews.comments,
      files,
    }
  }

  async addPrComment(repoPath: string, number: number, body: string): Promise<PrIssueComment> {
    const trimmedBody = body.trim()
    if (!trimmedBody) throw new Error('Comment body is required')

    const normalizedNumber = Math.max(1, Math.round(number || 0))
    const nwo = await resolveNwo(repoPath)
    const raw = await this.gh(
      [
        'api',
        `repos/${nwo}/issues/${normalizedNumber}/comments`,
        '-X',
        'POST',
        '-f',
        `body=${trimmedBody}`,
      ],
      repoPath,
      true
    )
    this.invalidatePrDetail(repoPath, normalizedNumber)
    return mapPrIssueComment(JSON.parse(raw || '{}') as Record<string, unknown>)
  }

  async replyToPrReviewComment(repoPath: string, number: number, commentId: number, body: string): Promise<PrReviewComment> {
    const trimmedBody = body.trim()
    if (!trimmedBody) throw new Error('Reply body is required')

    const normalizedNumber = Math.max(1, Math.round(number || 0))
    const normalizedCommentId = Math.max(1, Math.round(commentId || 0))
    const nwo = await resolveNwo(repoPath)
    const raw = await this.gh(
      [
        'api',
        `repos/${nwo}/pulls/${normalizedNumber}/comments/${normalizedCommentId}/replies`,
        '-X',
        'POST',
        '-f',
        `body=${trimmedBody}`,
      ],
      repoPath,
      true
    )
    this.invalidatePrDetail(repoPath, normalizedNumber)
    return mapPrReviewComment(JSON.parse(raw || '{}') as Record<string, unknown>, new Map())
  }

  async addPrReviewComment(
    repoPath: string,
    number: number,
    args: { body: string; commitId: string; path: string; side: 'LEFT' | 'RIGHT'; line: number }
  ): Promise<PrReviewComment> {
    const trimmedBody = args.body.trim()
    if (!trimmedBody) throw new Error('Comment body is required')
    if (!args.commitId.trim()) throw new Error('Pull request head commit is required')
    if (!args.path.trim()) throw new Error('File path is required')
    const normalizedLine = Math.max(1, Math.round(args.line || 0))
    const normalizedNumber = Math.max(1, Math.round(number || 0))
    const nwo = await resolveNwo(repoPath)
    const raw = await this.gh(
      [
        'api',
        `repos/${nwo}/pulls/${normalizedNumber}/comments`,
        '-X',
        'POST',
        '-f',
        `body=${trimmedBody}`,
        '-f',
        `commit_id=${args.commitId.trim()}`,
        '-f',
        `path=${args.path.trim()}`,
        '-f',
        `side=${args.side}`,
        '-F',
        `line=${normalizedLine}`,
      ],
      repoPath,
      true
    )
    this.invalidatePrDetail(repoPath, normalizedNumber)
    return mapPrReviewComment(JSON.parse(raw || '{}') as Record<string, unknown>, new Map())
  }

  async submitPrReview(repoPath: string, number: number, event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES', body = ''): Promise<boolean> {
    const normalizedNumber = Math.max(1, Math.round(number || 0))
    const normalizedEvent = event === 'APPROVE' || event === 'REQUEST_CHANGES' ? event : 'COMMENT'
    const trimmedBody = body.trim()
    if (normalizedEvent !== 'APPROVE' && !trimmedBody) throw new Error('Review body is required')

    const nwo = await resolveNwo(repoPath)
    const args = [
      'api',
      `repos/${nwo}/pulls/${normalizedNumber}/reviews`,
      '-X',
      'POST',
      '-f',
      `event=${normalizedEvent}`,
    ]
    if (trimmedBody) args.push('-f', `body=${trimmedBody}`)

    await this.gh(args, repoPath, true)
    this.invalidatePrDetail(repoPath, normalizedNumber)
    this.invalidateWorkItems(repoPath)
    return true
  }

  async resolvePrReviewThread(repoPath: string, number: number, threadId: string, resolve: boolean): Promise<boolean> {
    const normalizedNumber = Math.max(1, Math.round(number || 0))
    const trimmedThreadId = threadId.trim()
    if (!trimmedThreadId) throw new Error('Review thread ID is required')
    await this.assertRateLimitBudget(repoPath, 'graphql', 10)
    const mutation = resolve ? 'resolveReviewThread' : 'unresolveReviewThread'
    const query = `mutation($threadId: ID!) { ${mutation}(input: { threadId: $threadId }) { thread { isResolved } } }`
    await this.gh(
      ['api', 'graphql', '-f', `query=${query}`, '-f', `threadId=${trimmedThreadId}`],
      repoPath,
      true
    )
    this.invalidatePrDetail(repoPath, normalizedNumber)
    return true
  }

  async setPrFileViewed(repoPath: string, number: number, pullRequestId: string, path: string, viewed: boolean): Promise<boolean> {
    const normalizedNumber = Math.max(1, Math.round(number || 0))
    const trimmedPullRequestId = pullRequestId.trim()
    const trimmedPath = path.trim()
    if (!trimmedPullRequestId) throw new Error('Pull request ID is required')
    if (!trimmedPath) throw new Error('File path is required')
    await this.assertRateLimitBudget(repoPath, 'graphql', 10)
    const mutation = viewed ? 'markFileAsViewed' : 'unmarkFileAsViewed'
    const query = `mutation($pullRequestId: ID!, $path: String!) { ${mutation}(input: { pullRequestId: $pullRequestId, path: $path }) { pullRequest { id } } }`
    await this.gh(
      ['api', 'graphql', '-f', `query=${query}`, '-f', `pullRequestId=${trimmedPullRequestId}`, '-f', `path=${trimmedPath}`],
      repoPath,
      true
    )
    this.invalidatePrDetail(repoPath, normalizedNumber)
    return true
  }

  async getPrFilePreview(repoPath: string, number: number, path: string, ref: string): Promise<GitHubPrFilePreview> {
    const trimmedPath = path.trim()
    const trimmedRef = ref.trim()
    if (!trimmedPath) throw new Error('File path is required')
    if (!trimmedRef) throw new Error('File ref is required')
    await this.assertRateLimitBudget(repoPath, 'core', 10)
    const nwo = await resolveNwo(repoPath)
    const raw = await this.gh(
      ['api', `repos/${nwo}/contents/${encodeGitHubPath(trimmedPath)}?ref=${encodeURIComponent(trimmedRef)}`],
      repoPath,
      true
    )
    const data = JSON.parse(raw || '{}') as Record<string, unknown>
    const size = Number(data.size) || 0
    const content = getString(data.content).replace(/\s/g, '')
    const encoding = getString(data.encoding)
    const mimeType = getMimeType(trimmedPath)
    if (!content || encoding !== 'base64') {
      return { path: trimmedPath, kind: 'missing', mimeType, size }
    }
    if (isImageMimeType(mimeType)) {
      return {
        path: trimmedPath,
        kind: 'image',
        mimeType,
        size,
        dataUrl: `data:${mimeType};base64,${content}`,
      }
    }
    if (mimeType === 'text/plain' && size <= 200_000) {
      return {
        path: trimmedPath,
        kind: 'text',
        mimeType,
        size,
        text: Buffer.from(content, 'base64').toString('utf8'),
      }
    }
    return { path: trimmedPath, kind: 'binary', mimeType, size }
  }

  async requestPrReviewer(repoPath: string, number: number, reviewer: string): Promise<boolean> {
    const trimmedReviewer = reviewer.trim().replace(/^@+/, '')
    if (!trimmedReviewer) throw new Error('Reviewer is required')
    const normalizedNumber = Math.max(1, Math.round(number || 0))
    await this.assertRateLimitBudget(repoPath, 'core', 10)
    const nwo = await resolveNwo(repoPath)
    await this.gh(
      ['api', `repos/${nwo}/pulls/${normalizedNumber}/requested_reviewers`, '-X', 'POST', '-F', `reviewers[]=${trimmedReviewer}`],
      repoPath,
      true
    )
    this.invalidatePrDetail(repoPath, normalizedNumber)
    return true
  }

  async removePrReviewer(repoPath: string, number: number, reviewer: string): Promise<boolean> {
    const trimmedReviewer = reviewer.trim().replace(/^@+/, '')
    if (!trimmedReviewer) throw new Error('Reviewer is required')
    const normalizedNumber = Math.max(1, Math.round(number || 0))
    await this.assertRateLimitBudget(repoPath, 'core', 10)
    const nwo = await resolveNwo(repoPath)
    await this.gh(
      ['api', `repos/${nwo}/pulls/${normalizedNumber}/requested_reviewers`, '-X', 'DELETE', '-F', `reviewers[]=${trimmedReviewer}`],
      repoPath,
      true
    )
    this.invalidatePrDetail(repoPath, normalizedNumber)
    return true
  }

  async addPrLabel(repoPath: string, number: number, label: string): Promise<boolean> {
    const trimmedLabel = label.trim()
    if (!trimmedLabel) throw new Error('Label is required')
    const normalizedNumber = Math.max(1, Math.round(number || 0))
    await this.assertRateLimitBudget(repoPath, 'core', 10)
    const nwo = await resolveNwo(repoPath)
    await this.gh(
      ['api', `repos/${nwo}/issues/${normalizedNumber}/labels`, '-X', 'POST', '-f', `labels[]=${trimmedLabel}`],
      repoPath,
      true
    )
    this.invalidatePrDetail(repoPath, normalizedNumber)
    this.invalidateWorkItems(repoPath)
    return true
  }

  async removePrLabel(repoPath: string, number: number, label: string): Promise<boolean> {
    const trimmedLabel = label.trim()
    if (!trimmedLabel) throw new Error('Label is required')
    const normalizedNumber = Math.max(1, Math.round(number || 0))
    await this.assertRateLimitBudget(repoPath, 'core', 10)
    const nwo = await resolveNwo(repoPath)
    await this.gh(
      ['api', `repos/${nwo}/issues/${normalizedNumber}/labels/${encodeURIComponent(trimmedLabel)}`, '-X', 'DELETE'],
      repoPath,
      true
    )
    this.invalidatePrDetail(repoPath, normalizedNumber)
    this.invalidateWorkItems(repoPath)
    return true
  }

  async rerunCheck(repoPath: string, checkUrl: string, failedOnly: boolean): Promise<boolean> {
    const runMatch = checkUrl.match(/\/actions\/runs\/(\d+)/)
    if (!runMatch?.[1]) throw new Error('Could not resolve GitHub Actions run from check URL')
    const nwo = await resolveNwo(repoPath)
    const endpoint = failedOnly
      ? `repos/${nwo}/actions/runs/${runMatch[1]}/rerun-failed-jobs`
      : `repos/${nwo}/actions/runs/${runMatch[1]}/rerun`
    await this.gh(['api', '-X', 'POST', endpoint], repoPath, true)
    this.invalidatePrDetail(repoPath)
    this.checksCache.invalidate(repoPath)
    return true
  }

  async toggleReaction(repoPath: string, number: number, subjectId: string, content: GitHubReactionContent, reacted: boolean): Promise<boolean> {
    const normalizedNumber = Math.max(1, Math.round(number || 0))
    const trimmedSubjectId = subjectId.trim()
    if (!trimmedSubjectId) throw new Error('Reaction subject ID is required')
    if (!content) throw new Error('Reaction content is required')
    await this.assertRateLimitBudget(repoPath, 'graphql', 10)
    const mutation = reacted ? 'removeReaction' : 'addReaction'
    const query = `mutation($subjectId: ID!, $content: ReactionContent!) { ${mutation}(input: { subjectId: $subjectId, content: $content }) { subject { id } } }`
    await this.gh(
      ['api', 'graphql', '-f', `query=${query}`, '-f', `subjectId=${trimmedSubjectId}`, '-f', `content=${content}`],
      repoPath,
      true
    )
    this.invalidatePrDetail(repoPath, normalizedNumber)
    return true
  }

  protected async _fetchWorkItems(repoPath: string, limit: number, rawQuery: string): Promise<ListWorkItemsResult> {
    const nwo = await resolveNwo(repoPath)
    const query = parseTaskQuery(rawQuery)
    const hasPrOnlyFilter = query.state === 'merged' || query.draft || query.reviewRequested !== null || query.reviewedBy !== null
    const includeIssues = query.scope !== 'pr' && !hasPrOnlyFilter
    const includePrs = query.scope !== 'issue'

    const [issues, prs] = await Promise.all([
      includeIssues ? this._fetchWorkItemsByKind(repoPath, nwo, 'issue', limit, query) : Promise.resolve([]),
      includePrs ? this._fetchWorkItemsByKind(repoPath, nwo, 'pr', limit, query) : Promise.resolve([]),
    ])

    const items = [...issues, ...prs]
      .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())
      .slice(0, limit)
    return { items }
  }

  protected async _fetchWorkItemsByKind(
    repoPath: string,
    nwo: string,
    kind: GitHubWorkItemType,
    limit: number,
    query: ParsedTaskQuery
  ): Promise<GitHubWorkItem[]> {
    const args = this._buildWorkItemListArgs(nwo, kind, limit, query)
    const raw = await this.gh(args, repoPath, true)
    const data = JSON.parse(raw || '[]') as Array<Record<string, unknown>>
    const items = data.map((item) => kind === 'pr' ? mapPrWorkItem(item) : mapIssueWorkItem(item))
    if (kind === 'pr' && query.state === 'closed') {
      return items.filter((item) => item.state !== 'merged')
    }
    return items
  }

  protected _buildWorkItemListArgs(
    nwo: string,
    kind: GitHubWorkItemType,
    limit: number,
    query: ParsedTaskQuery
  ): string[] {
    const fields = kind === 'pr' ? WORK_ITEM_PR_LIST_JSON_FIELDS : WORK_ITEM_ISSUE_LIST_JSON_FIELDS
    const args = [kind === 'pr' ? 'pr' : 'issue', 'list', '--limit', String(limit), '--json', fields, '--repo', nwo]

    if (query.state && query.state !== 'merged') {
      args.push('--state', query.state)
    } else if (query.state === 'merged') {
      args.push('--state', 'merged')
    }
    if (query.assignee) args.push('--assignee', query.assignee)
    if (query.author) args.push('--author', query.author)
    for (const label of query.labels) args.push('--label', label)
    if (kind === 'pr' && query.draft) args.push('--draft')

    const searchParts: string[] = []
    if (kind === 'pr' && query.state === 'closed') searchParts.push('-is:merged')
    if (kind === 'pr' && query.reviewRequested) searchParts.push(`review-requested:${query.reviewRequested}`)
    if (kind === 'pr' && query.reviewedBy) searchParts.push(`reviewed-by:${query.reviewedBy}`)
    if (query.freeText) searchParts.push(query.freeText)
    if (searchParts.length > 0) args.push('--search', searchParts.join(' '))

    return args
  }

  protected async _fetchWorkItemCount(repoPath: string, rawQuery: string): Promise<number> {
    if (!await this.hasRateLimitBudget(repoPath, 'search', 2)) return 0
    const nwo = await resolveNwo(repoPath)
    const query = parseTaskQuery(rawQuery)
    const searchQ = buildSearchQueryString(nwo, query)
    const raw = await this.gh(
      ['api', `search/issues?q=${encodeURIComponent(searchQ)}&per_page=1`, '--jq', '.total_count'],
      repoPath,
      true
    )
    return parseInt(raw.trim(), 10) || 0
  }


}
