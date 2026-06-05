export type PRCommentAudienceFilter = 'all' | 'human' | 'bot'

export interface PRCommentAudienceItem {
  author: string
  isBot?: boolean
}

const BOT_LOGIN_SUFFIX = '[bot]'
const AUTOMATION_LOGIN_PATTERNS = [
  /bot$/i,
  /-bot$/i,
  /\bbot\b/i,
  /automation/i,
  /actions/i,
  /renovate/i,
  /dependabot/i,
]

const KNOWN_AUTOMATION_LOGIN_SUBSTRINGS = [
  'chatgpt-codex-connector',
  'codex-connector',
  'qodo',
  'coderabbit',
  'codium',
  'sonarcloud',
  'sonarqube',
  'sourcery-ai',
  'deepsource',
  'snyk',
  'codecov',
  'greptile',
  'ellipsis',
  'graphite-app',
  'reviewer-gpt',
  '-reviewer',
]

export function isBotPRComment(comment: PRCommentAudienceItem): boolean {
  if (comment.isBot === true) return true
  const author = comment.author.trim()
  const normalized = author.toLowerCase()
  if (normalized.endsWith(BOT_LOGIN_SUFFIX)) return true
  if (KNOWN_AUTOMATION_LOGIN_SUBSTRINGS.some((needle) => normalized.includes(needle))) return true
  return AUTOMATION_LOGIN_PATTERNS.some((pattern) => pattern.test(author))
}

export function getPRCommentAudienceCounts<T extends PRCommentAudienceItem>(
  comments: T[]
): Record<PRCommentAudienceFilter, number> {
  const bot = comments.filter(isBotPRComment).length
  return {
    all: comments.length,
    human: comments.length - bot,
    bot,
  }
}

export function filterPRCommentsByAudience<T extends PRCommentAudienceItem>(
  comments: T[],
  filter: PRCommentAudienceFilter
): T[] {
  if (filter === 'bot') return comments.filter(isBotPRComment)
  if (filter === 'human') return comments.filter((comment) => !isBotPRComment(comment))
  return comments
}
