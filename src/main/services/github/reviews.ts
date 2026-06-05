import { GitHubStatusChecks } from "./statusChecks"
import { resolveNwo } from "./core"
import type {
  GitHubPrFile,
  PrGraphqlMetadata,
  PrIssueComment,
  PrReview,
  PrReviewComment,
  PrReviewData,
  ReviewState,
} from "./types"
import {
  getAuthorAvatarUrl,
  getAuthorIsBot,
  getAuthorLogin,
  getString,
  mapPrFile,
  mapPrIssueComment,
  mapPrReviewComment,
  mapReactionGroups,
} from "./mappers"

export abstract class GitHubReviews extends GitHubStatusChecks {
  async getReviews(worktreePath: string, forceRefresh?: boolean): Promise<PrReviewData> {
    return await this.reviewsCache.get(worktreePath, () => this._fetchReviews(worktreePath), { forceRefresh })
  }

  async replyToReviewComment(worktreePath: string, commentId: number, body: string): Promise<void> {
    const trimmedBody = body.trim()
    if (!trimmedBody) throw new Error('Reply body is required')

    const nwo = await resolveNwo(worktreePath)
    const pr = await this.getPrStatus(worktreePath)
    if (!pr) throw new Error('No pull request found for this worktree')

    await this.gh(
      [
        'api',
        `repos/${nwo}/pulls/${pr.number}/comments/${commentId}/replies`,
        '-X',
        'POST',
        '-f',
        `body=${trimmedBody}`,
      ],
      worktreePath,
      true,
    )
    this.reviewsCache.invalidate(worktreePath)
    this.invalidatePrDetail(worktreePath)
  }

  protected async _fetchIssueCommentsForPr(repoPath: string, nwo: string, prNumber: number): Promise<PrIssueComment[]> {
    const commentsRaw = await this.gh(
      ['api', `repos/${nwo}/issues/${prNumber}/comments`, '--paginate'],
      repoPath
    )
    try {
      const data = JSON.parse(commentsRaw || '[]') as Array<Record<string, unknown>>
      return data.map(mapPrIssueComment)
    } catch {
      return []
    }
  }

  protected async _fetchFilesForPr(
    repoPath: string,
    nwo: string,
    prNumber: number,
    viewedStates = new Map<string, GitHubPrFile['viewedState']>()
  ): Promise<GitHubPrFile[]> {
    const filesRaw = await this.gh(
      ['api', `repos/${nwo}/pulls/${prNumber}/files?per_page=100`, '--paginate'],
      repoPath
    )
    try {
      const data = JSON.parse(filesRaw || '[]') as Array<Record<string, unknown>>
      return data.map((file) => mapPrFile(file, viewedStates)).filter((file) => file.path)
    } catch {
      return []
    }
  }

  protected async _fetchReviews(worktreePath: string): Promise<PrReviewData> {
    const nwo = await resolveNwo(worktreePath)
    const pr = await this.getPrStatus(worktreePath)
    if (!pr) return { reviews: [], comments: [] }
    const metadata = await this._fetchPrGraphqlMetadata(worktreePath, nwo, pr.number)
    return this._fetchReviewsForPr(worktreePath, nwo, pr.number, metadata.reviewCommentThreads)
  }

  protected async _fetchReviewsForPr(
    repoPath: string,
    nwo: string,
    prNumber: number,
    threadData = new Map<number, PrGraphqlMetadata['reviewCommentThreads'] extends Map<number, infer T> ? T : never>()
  ): Promise<PrReviewData> {
    const [reviewsRaw, commentsRaw] = await Promise.all([
      this.gh(['api', `repos/${nwo}/pulls/${prNumber}/reviews`, '--paginate'], repoPath),
      this.gh(['api', `repos/${nwo}/pulls/${prNumber}/comments`, '--paginate'], repoPath),
    ])

    let reviews: PrReview[] = []
    let comments: PrReviewComment[] = []

    try {
      const data = JSON.parse(reviewsRaw || '[]')
      reviews = (data as Array<Record<string, unknown>>).map((r) => ({
        id: r.id as number,
        author: (r.user as Record<string, unknown>)?.login as string ?? 'unknown',
        authorAvatarUrl: (r.user as Record<string, unknown>)?.avatar_url as string ?? '',
        state: r.state as ReviewState,
        body: (r.body as string) ?? '',
        submittedAt: r.submitted_at as string,
        htmlUrl: r.html_url as string,
      }))
    } catch { /* ignore parse errors */ }

    try {
      const data = JSON.parse(commentsRaw || '[]')
      comments = (data as Array<Record<string, unknown>>).map((c) => mapPrReviewComment(c, threadData))
    } catch { /* ignore parse errors */ }

    return { reviews, comments }
  }

  protected async _fetchPrGraphqlMetadata(repoPath: string, nwo: string, prNumber: number): Promise<PrGraphqlMetadata> {
    const [owner, repo] = nwo.split('/')
    const metadata: PrGraphqlMetadata = {
      pullRequestId: '',
      issueComments: [],
      reviewCommentThreads: new Map(),
      viewedStates: new Map(),
    }
    try {
      if (!await this.hasRateLimitBudget(repoPath, 'graphql', 10)) return metadata
      const query = `
        query($owner: String!, $repo: String!, $number: Int!, $fileAfter: String, $threadAfter: String, $fetchFiles: Boolean!, $fetchThreads: Boolean!) {
          repository(owner: $owner, name: $repo) {
            pullRequest(number: $number) {
              id
              comments(first: 100) {
                nodes {
                  id
                  databaseId
                  author { __typename login avatarUrl }
                  body
                  createdAt
                  updatedAt
                  url
                  reactionGroups {
                    content
                    viewerHasReacted
                    reactors { totalCount }
                  }
                }
              }
              files(first: 100, after: $fileAfter) @include(if: $fetchFiles) {
                nodes { path viewerViewedState }
                pageInfo { hasNextPage endCursor }
              }
              reviewThreads(first: 100, after: $threadAfter) @include(if: $fetchThreads) {
                nodes {
                  id
                  isResolved
                  isOutdated
                  line
                  startLine
                  originalLine
                  originalStartLine
                  comments(first: 100) {
                    nodes {
                      id
                      databaseId
                      author { __typename login avatarUrl }
                      body
                      createdAt
                      updatedAt
                      url
                      reactionGroups {
                        content
                        viewerHasReacted
                        reactors { totalCount }
                      }
                    }
                  }
                }
                pageInfo { hasNextPage endCursor }
              }
            }
          }
        }
      `

      let fileAfter: string | undefined
      let threadAfter: string | undefined
      let fetchFiles = true
      let fetchThreads = true
      let hasNextPage = true

      while (hasNextPage) {
        const args = [
          'api', 'graphql',
          '-f', `query=${query}`,
          '-F', `owner=${owner}`,
          '-F', `repo=${repo}`,
          '-F', `number=${prNumber}`,
          '-F', `fetchFiles=${fetchFiles}`,
          '-F', `fetchThreads=${fetchThreads}`,
        ]
        if (fileAfter) args.push('-F', `fileAfter=${fileAfter}`)
        if (threadAfter) args.push('-F', `threadAfter=${threadAfter}`)

        const raw = await this.gh(args, repoPath)
        if (!raw) break

        const parsed = JSON.parse(raw) as {
          data?: {
            repository?: {
              pullRequest?: {
                id?: string
                comments?: {
                  nodes?: Array<Record<string, unknown>>
                }
                files?: {
                  nodes?: Array<{ path?: string; viewerViewedState?: GitHubPrFile['viewedState'] }>
                  pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }
                }
                reviewThreads?: {
                  nodes?: Array<{
                    id: string
                    isResolved: boolean
                    isOutdated?: boolean
                    line?: number | null
                    startLine?: number | null
                    originalLine?: number | null
                    originalStartLine?: number | null
                    comments: { nodes: Array<Record<string, unknown>> }
                  }>
                  pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }
                }
              }
            }
          }
        }

        const pullRequest = parsed.data?.repository?.pullRequest
        if (pullRequest?.id) metadata.pullRequestId = pullRequest.id
        if (!fileAfter && !threadAfter && pullRequest?.comments?.nodes) {
          metadata.issueComments = pullRequest.comments.nodes.map((comment) => ({
            id: Number(comment.databaseId) || 0,
            subjectId: getString(comment.id),
            author: getAuthorLogin(comment.author) || 'unknown',
            authorAvatarUrl: getAuthorAvatarUrl(comment.author),
            isBot: getAuthorIsBot(comment.author),
            body: getString(comment.body),
            createdAt: getString(comment.createdAt),
            updatedAt: getString(comment.updatedAt),
            htmlUrl: getString(comment.url),
            reactions: mapReactionGroups(comment.reactionGroups),
          })).filter((comment) => comment.id > 0)
        }
        for (const file of pullRequest?.files?.nodes ?? []) {
          const path = file.path ?? ''
          if (path) metadata.viewedStates.set(path, file.viewerViewedState ?? null)
        }

        const reviewThreads = pullRequest?.reviewThreads
        const threads = reviewThreads?.nodes
        if (threads) {
          for (const thread of threads) {
            const threadLine = thread.line ?? thread.originalLine ?? null
            const threadStartLine = thread.startLine ?? thread.originalStartLine ?? null
            for (const comment of thread.comments.nodes) {
              const id = Number(comment.databaseId) || 0
              if (!id) continue
              metadata.reviewCommentThreads.set(id, {
                threadId: thread.id,
                isResolved: thread.isResolved,
                isOutdated: thread.isOutdated === true || thread.line === null,
                line: threadLine,
                startLine: threadStartLine,
                subjectId: getString(comment.id),
                author: getAuthorLogin(comment.author) || undefined,
                authorAvatarUrl: getAuthorAvatarUrl(comment.author) || undefined,
                isBot: getAuthorIsBot(comment.author),
                body: getString(comment.body) || undefined,
                createdAt: getString(comment.createdAt) || undefined,
                htmlUrl: getString(comment.url) || undefined,
                reactions: mapReactionGroups(comment.reactionGroups),
              })
            }
          }
        }

        const filesHasNext: boolean = fetchFiles && pullRequest?.files?.pageInfo?.hasNextPage === true
        const threadsHasNext: boolean = fetchThreads && reviewThreads?.pageInfo?.hasNextPage === true
        fileAfter = filesHasNext ? pullRequest?.files?.pageInfo?.endCursor ?? undefined : undefined
        threadAfter = threadsHasNext ? reviewThreads?.pageInfo?.endCursor ?? undefined : undefined
        fetchFiles = filesHasNext
        fetchThreads = threadsHasNext
        hasNextPage = filesHasNext || threadsHasNext
        if (hasNextPage && !fileAfter && !threadAfter) break
      }
    } catch { /* GraphQL metadata lookup is best-effort */ }
    return metadata
  }

}
