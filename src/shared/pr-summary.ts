export interface PrSummaryLike {
  type: string
  number: number
  title: string
  state: string
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

const PR_SUMMARY_KEYS = [
  'title',
  'state',
  'url',
  'author',
  'labels',
  'assignees',
  'updatedAt',
  'isDraft',
  'headBranch',
  'baseBranch',
  'mergeable',
  'reviewDecision',
  'mergeStateStatus',
] as const

export function mergePrSummary<T extends PrSummaryLike>(target: T, summary: PrSummaryLike): T {
  let changed = false
  const next = { ...target } as T
  const nextRecord = next as Record<string, unknown>
  for (const key of PR_SUMMARY_KEYS) {
    if (isSameSummaryValue(target[key], summary[key])) continue
    nextRecord[key] = summary[key]
    changed = true
  }
  return changed ? next : target
}

function isSameSummaryValue(a: PrSummaryLike[keyof PrSummaryLike], b: PrSummaryLike[keyof PrSummaryLike]): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return a === b
  return a.length === b.length && a.every((value, index) => value === b[index])
}
