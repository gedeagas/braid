export interface PrStatus {
  number: number
  title: string
  state: string
  url: string
  headBranch: string
  mergeable?: string
  isDraft?: boolean
  baseRefName?: string
  /** APPROVED | CHANGES_REQUESTED | REVIEW_REQUIRED | '' (no review policy) */
  reviewDecision?: string
  /** BEHIND | BLOCKED | CLEAN | DIRTY | DRAFT | HAS_HOOKS | UNKNOWN | UNSTABLE */
  mergeStateStatus?: string
}

export interface CheckRun {
  name: string
  status: string
  conclusion: string | null
  url: string
  startedAt?: string | null
  completedAt?: string | null
  workflowName?: string | null
}

export interface Deployment {
  environment: string
  state: string
  url?: string
  updatedAt?: string
}

export interface GitSyncStatus {
  uncommittedChanges: number
  behindCount: number
  aheadCount: number
  baseBranch: string | null
}

export type ReviewState = 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'PENDING' | 'DISMISSED'

export interface PrReview {
  id: number
  author: string
  authorAvatarUrl: string
  state: ReviewState
  body: string
  submittedAt: string
  htmlUrl: string
}

export type GitHubReactionContent = 'THUMBS_UP' | 'THUMBS_DOWN' | 'LAUGH' | 'HOORAY' | 'CONFUSED' | 'HEART' | 'ROCKET' | 'EYES'

export interface GitHubReactionGroup {
  content: GitHubReactionContent
  count: number
  viewerHasReacted: boolean
}

export interface PrReviewComment {
  id: number
  subjectId: string
  reviewId: number
  author: string
  authorAvatarUrl: string
  isBot: boolean
  body: string
  path: string
  line: number | null
  startLine: number | null
  originalLine: number | null
  side: 'LEFT' | 'RIGHT'
  diffHunk: string
  createdAt: string
  updatedAt: string
  htmlUrl: string
  inReplyToId: number | null
  threadId: string | null
  isResolved: boolean
  isOutdated: boolean
  reactions: GitHubReactionGroup[]
}

export interface PrIssueComment {
  id: number
  subjectId: string
  author: string
  authorAvatarUrl: string
  isBot: boolean
  body: string
  createdAt: string
  updatedAt: string
  htmlUrl: string
  reactions: GitHubReactionGroup[]
}

export interface PrReviewData {
  reviews: PrReview[]
  comments: PrReviewComment[]
}

export interface GitHubPrFile {
  path: string
  previousPath: string | null
  status: string
  viewedState: 'VIEWED' | 'UNVIEWED' | 'DISMISSED' | null
  additions: number
  deletions: number
  changes: number
  patch: string
  isBinary: boolean
}

export interface GitHubPrFilePreview {
  path: string
  kind: 'image' | 'binary' | 'text' | 'missing'
  mimeType: string
  size: number
  dataUrl?: string
  text?: string
}

export type GitHubWorkItemType = 'issue' | 'pr'
export type GitHubWorkItemState = 'open' | 'closed' | 'merged'

export interface GitHubWorkItem {
  id: string
  type: GitHubWorkItemType
  number: number
  title: string
  state: GitHubWorkItemState
  url: string
  author: string
  labels: string[]
  assignees: string[]
  updatedAt: string
  isDraft?: boolean
  headBranch?: string
  baseBranch?: string
  mergeable?: string
  reviewDecision?: string
  mergeStateStatus?: string
}

export interface GitHubLabel {
  name: string
  color: string
  description: string | null
}

export interface ListWorkItemsResult {
  items: GitHubWorkItem[]
}

export interface GitHubReviewerSuggestion {
  login: string
  name: string | null
  avatarUrl: string
}

export type GitHubLabelSuggestion = GitHubLabel

export interface GitHubPrDetailItem extends GitHubWorkItem {
  body: string
  createdAt: string
  pullRequestId: string
  headRefOid: string
  additions: number
  deletions: number
  changedFiles: number
  commitsCount: number
  repoNameWithOwner: string
  reviewRequests: string[]
  labelDetails: GitHubLabel[]
}

export interface GitHubPrDetail {
  item: GitHubPrDetailItem
  checks: CheckRun[]
  reviews: PrReview[]
  issueComments: PrIssueComment[]
  comments: PrReviewComment[]
  files: GitHubPrFile[]
}

export interface PrGraphqlMetadata {
  pullRequestId: string
  issueComments: PrIssueComment[]
  reviewCommentThreads: Map<number, {
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
  viewedStates: Map<string, GitHubPrFile['viewedState']>
}

export const WORK_ITEM_ISSUE_LIST_JSON_FIELDS = 'number,title,state,url,labels,updatedAt,author,assignees'
export const WORK_ITEM_PR_LIST_JSON_FIELDS = 'number,title,state,url,labels,updatedAt,author,assignees,isDraft,headRefName,baseRefName,mergeable,reviewDecision,mergeStateStatus'
export const PR_DETAIL_JSON_FIELDS = [
  'number',
  'title',
  'state',
  'url',
  'labels',
  'updatedAt',
  'author',
  'assignees',
  'isDraft',
  'headRefName',
  'baseRefName',
  'mergeable',
  'reviewDecision',
  'reviewRequests',
  'mergeStateStatus',
  'body',
  'createdAt',
  'headRefOid',
  'additions',
  'deletions',
  'changedFiles',
  'commits',
].join(',')
