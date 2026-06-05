import type { ReactNode } from 'react'
import type { Project } from '@/types'

export type WorkItemType = 'issue' | 'pr'
export type WorkItemState = 'open' | 'closed' | 'merged'
export type QuickFilter =
  | 'author:@me'
  | 'assignee:@me'
  | 'review-requested:@me'
  | 'reviewed-by:@me'
  | 'is:open'
  | 'is:closed'
  | 'is:merged'
  | 'is:draft'
  | 'is:pr'
  | 'is:issue'

export interface FilterSuggestion {
  value: string
  description: string
  descriptionKey?: string
  aliases?: string[]
}

export interface RepoFilterOption {
  value: string
  description: string
  aliases: string[]
}

export interface RepoPickerProps {
  projects: Project[]
  selectedIds: ReadonlySet<string>
  onChange: (nextIds: ReadonlySet<string>) => void
  onSelectAll: () => void
}

export interface TaskFilterPill {
  key: string
  label: string
  value: string
  clear: () => void
}

export interface GitHubWorkItem {
  id: string
  type: WorkItemType
  number: number
  title: string
  state: WorkItemState
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

export interface CheckRun {
  name: string
  status: string
  conclusion: string | null
  url: string
  startedAt?: string | null
  completedAt?: string | null
  workflowName?: string | null
}

export interface PrReview {
  id: number
  author: string
  authorAvatarUrl: string
  state: string
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

export interface GitHubPrDetail {
  item: GitHubPrDetailItem
  checks: CheckRun[]
  reviews: PrReview[]
  issueComments: PrIssueComment[]
  comments: PrReviewComment[]
  files: GitHubPrFile[]
}

export interface GitHubReviewerSuggestion {
  login: string
  name: string | null
  avatarUrl: string
}

export type GitHubLabelSuggestion = GitHubLabel

export interface GitHubPrFilePreview {
  path: string
  kind: 'image' | 'binary' | 'text' | 'missing'
  mimeType: string
  size: number
  dataUrl?: string
  text?: string
}

export type UiIssueComment = PrIssueComment & {
  pending?: boolean
  error?: string
}

export type UiReviewComment = PrReviewComment & {
  pending?: boolean
  error?: string
}

export type TimelineEntry =
  | { kind: 'issue-comment'; at: string; item: UiIssueComment }
  | { kind: 'review'; at: string; item: PrReview }
  | { kind: 'review-comment'; at: string; item: UiReviewComment }

export type DiffLineKind = 'hunk' | 'context' | 'add' | 'delete' | 'note'

export interface DiffLine {
  id: string
  kind: DiffLineKind
  text: string
  oldLine: number | null
  newLine: number | null
}

export interface TaskRow {
  projectId: string
  projectName: string
  repoPath: string
  item: GitHubWorkItem
  matchingWorktreeId: string | null
  matchingBranch: string | null
}

export interface QueryTokenRange {
  start: number
  end: number
  value: string
}

export type Renderable = ReactNode
