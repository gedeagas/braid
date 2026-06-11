import type { TaskActivityFilter } from '@/store/tasks'
import type { GitHubReactionContent } from './types'

export const DEFAULT_QUERY = 'author:@me is:pr is:open'
export const PER_REPO_LIMIT = 50
export const MAX_PER_REPO_LIMIT = 100
export const PR_SUMMARY_POLL_MS = 45 * 1000

export const PRESETS = [
  { id: 'my-prs', labelKey: 'presets.mine', query: 'author:@me is:pr is:open' },
  { id: 'review', labelKey: 'presets.needsReview', query: 'review-requested:@me is:pr is:open' },
  { id: 'open-prs', labelKey: 'presets.openPrs', query: 'is:pr is:open' },
  { id: 'issues', labelKey: 'presets.issues', query: 'assignee:@me is:issue is:open' },
] as const

export const ACTIVITY_FILTERS: Array<{ id: TaskActivityFilter; labelKey: string }> = [
  { id: 'all', labelKey: 'conversation.activityAll' },
  { id: 'human', labelKey: 'conversation.activityHuman' },
  { id: 'bot', labelKey: 'conversation.activityBot' },
]

export const REACTION_OPTIONS: Array<{ content: GitHubReactionContent; labelKey: string; symbol: string }> = [
  { content: 'THUMBS_UP', labelKey: 'reactions.thumbsUp', symbol: '👍' },
  { content: 'THUMBS_DOWN', labelKey: 'reactions.thumbsDown', symbol: '👎' },
  { content: 'LAUGH', labelKey: 'reactions.laugh', symbol: '😄' },
  { content: 'HOORAY', labelKey: 'reactions.hooray', symbol: '🎉' },
  { content: 'CONFUSED', labelKey: 'reactions.confused', symbol: '😕' },
  { content: 'HEART', labelKey: 'reactions.heart', symbol: '❤️' },
  { content: 'ROCKET', labelKey: 'reactions.rocket', symbol: '🚀' },
  { content: 'EYES', labelKey: 'reactions.eyes', symbol: '👀' },
]

export const FILTER_SUGGESTIONS = [
  { value: 'author:@me', description: 'Created by you', descriptionKey: 'filterSuggestions.createdByYou', aliases: ['mine', 'me'] },
  { value: 'assignee:@me', description: 'Assigned to you', descriptionKey: 'filterSuggestions.assignedToYou', aliases: ['assigned', 'me'] },
  { value: 'review-requested:@me', description: 'Needs your review', descriptionKey: 'filterSuggestions.needsYourReview', aliases: ['review', 'requested'] },
  { value: 'reviewed-by:@me', description: 'Reviewed by you', descriptionKey: 'filterSuggestions.reviewedByYou', aliases: ['reviewed'] },
  { value: 'repo:', description: 'Filter by repository', descriptionKey: 'filterSuggestions.filterByRepository', aliases: ['repository', 'project'] },
  { value: 'is:pr', description: 'Pull requests', descriptionKey: 'filterSuggestions.pullRequests', aliases: ['pull request', 'pr'] },
  { value: 'is:issue', description: 'Issues', descriptionKey: 'filterSuggestions.issues', aliases: ['issue'] },
  { value: 'is:open', description: 'Open tasks', descriptionKey: 'filterSuggestions.openTasks', aliases: ['open'] },
  { value: 'is:closed', description: 'Closed tasks', descriptionKey: 'filterSuggestions.closedTasks', aliases: ['closed'] },
  { value: 'is:merged', description: 'Merged pull requests', descriptionKey: 'filterSuggestions.mergedPullRequests', aliases: ['merged'] },
  { value: 'is:draft', description: 'Draft pull requests', descriptionKey: 'filterSuggestions.draftPullRequests', aliases: ['draft'] },
  { value: 'state:all', description: 'All states', descriptionKey: 'filterSuggestions.allStates', aliases: ['all'] },
  { value: 'label:', description: 'Filter by label name', descriptionKey: 'filterSuggestions.filterByLabel', aliases: ['labels'] },
]
