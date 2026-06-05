export type ParsedTaskQuery = {
  scope: 'all' | 'issue' | 'pr'
  state: 'open' | 'closed' | 'all' | 'merged' | null
  draft: boolean
  assignee: string | null
  author: string | null
  reviewRequested: string | null
  reviewedBy: string | null
  labels: string[]
  freeText: string
}

type SearchQueryToken = {
  value: string
  raw: string
}

function tokenizeSearchQueryWithRaw(rawQuery: string): SearchQueryToken[] {
  const tokens: SearchQueryToken[] = []
  let value = ''
  let raw = ''
  let quote: '"' | "'" | null = null

  const flush = (): void => {
    if (value || raw) {
      tokens.push({ value, raw })
      value = ''
      raw = ''
    }
  }

  for (let i = 0; i < rawQuery.length; i += 1) {
    const char = rawQuery[i]
    if (/\s/.test(char) && quote === null) {
      flush()
      continue
    }
    raw += char
    if ((char === '"' || char === "'") && quote === null) {
      quote = char
      continue
    }
    if (char === quote) {
      quote = null
      continue
    }
    value += char
  }
  flush()
  return tokens
}

export function tokenizeSearchQuery(rawQuery: string): string[] {
  return tokenizeSearchQueryWithRaw(rawQuery).map((token) => token.value)
}

export function parseTaskQuery(rawQuery: string): ParsedTaskQuery {
  const query: ParsedTaskQuery = {
    scope: 'all',
    state: null,
    draft: false,
    assignee: null,
    author: null,
    reviewRequested: null,
    reviewedBy: null,
    labels: [],
    freeText: '',
  }

  const freeTextTokens: string[] = []
  let sawIssueScope = false
  let sawPrScope = false

  for (const { value: token, raw } of tokenizeSearchQueryWithRaw(rawQuery.trim())) {
    const normalized = token.toLowerCase()
    if (normalized === 'is:issue') {
      sawIssueScope = true
      query.scope = sawPrScope ? 'all' : 'issue'
      continue
    }
    if (normalized === 'is:pr' || normalized === 'is:pull-request') {
      sawPrScope = true
      query.scope = sawIssueScope ? 'all' : 'pr'
      continue
    }
    if (normalized === 'is:open') {
      query.state = 'open'
      continue
    }
    if (normalized === 'is:closed') {
      query.state = 'closed'
      continue
    }
    if (normalized === 'is:merged') {
      query.state = 'merged'
      continue
    }
    if (normalized === 'is:draft') {
      query.scope = 'pr'
      query.state = 'open'
      query.draft = true
      continue
    }

    const [rawKey, ...rest] = token.split(':')
    const value = rest.join(':').trim()
    const key = rawKey.toLowerCase()
    if (!value) {
      freeTextTokens.push(raw)
      continue
    }

    if (key === 'assignee') {
      query.assignee = value
      continue
    }
    if (key === 'author') {
      query.author = value
      continue
    }
    if (key === 'review-requested') {
      query.scope = 'pr'
      query.reviewRequested = value
      continue
    }
    if (key === 'reviewed-by') {
      query.scope = 'pr'
      query.reviewedBy = value
      continue
    }
    if (key === 'label') {
      query.labels.push(value)
      continue
    }

    const normalizedValue = value.toLowerCase()
    if (
      key === 'state' &&
      (normalizedValue === 'open' ||
        normalizedValue === 'closed' ||
        normalizedValue === 'merged' ||
        normalizedValue === 'all')
    ) {
      query.state = normalizedValue
      continue
    }

    freeTextTokens.push(raw)
  }

  if (query.draft) {
    query.scope = 'pr'
    query.state = 'open'
  } else if (query.state === 'merged' || query.reviewRequested !== null || query.reviewedBy !== null) {
    query.scope = 'pr'
  }

  query.freeText = freeTextTokens.join(' ').trim()
  return query
}

export function stripRepoQualifiers(rawQuery: string): string {
  const kept: string[] = []
  for (const token of tokenizeSearchQuery(rawQuery.trim())) {
    if (/^repo:[^\s]+$/i.test(token)) continue
    if (/\s/.test(token)) {
      const [rawKey, ...rest] = token.split(':')
      kept.push(rest.length > 0 ? `${rawKey}:"${rest.join(':')}"` : `"${token}"`)
    } else {
      kept.push(token)
    }
  }
  return kept.join(' ')
}

export function getRepoQualifiers(rawQuery: string): string[] {
  const repos: string[] = []
  for (const token of tokenizeSearchQuery(rawQuery.trim())) {
    const [rawKey, ...rest] = token.split(':')
    if (rawKey.toLowerCase() !== 'repo') continue
    const value = rest.join(':').trim()
    if (value) repos.push(value)
  }
  return repos
}
