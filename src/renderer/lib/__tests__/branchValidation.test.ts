import { describe, it, expect } from 'vitest'
import { worktreeName, validateBranchName, extractJiraKey, deriveBranchFromJira } from '../branchValidation'

describe('worktreeName', () => {
  it('returns the last path segment', () => {
    expect(worktreeName('/Users/agas/Braid/worktrees/proj/my-branch', 'fallback')).toBe('my-branch')
  })

  it('returns fallback for empty path', () => {
    expect(worktreeName('', 'fallback')).toBe('fallback')
  })

  it('returns fallback for trailing slash (malformed path)', () => {
    expect(worktreeName('/Users/agas/Braid/worktrees/proj/my-branch/', 'fallback')).toBe('fallback')
  })

  it('returns the name itself when path has no slashes', () => {
    expect(worktreeName('my-branch', 'fallback')).toBe('my-branch')
  })
})

describe('validateBranchName', () => {
  // ── valid names ────────────────────────────────────────────────────────────

  it.each([
    'main',
    'feature/my-feature',
    'fix/TICKET-123',
    'release-1.2.3',
    'user/john/experiment',
    'chore/update-deps',
    'v2.0',
    'abc',
    '123',                  // numeric-only is valid
    'head',                 // lowercase reserved word — NOT in the reserved set
    'fetch_head',           // lowercase variant of FETCH_HEAD — valid
    'feature.lock.ext',     // contains .lock but does not END with .lock — valid
    'user@work',            // @ not followed by { — valid
    'trailing-',            // hyphen at end — valid
    'release-1.0',          // single dot in middle — valid
  ])('accepts valid branch name: %s', (name) => {
    expect(validateBranchName(name)).toBeNull()
  })

  // ── empty / blank ──────────────────────────────────────────────────────────

  it('rejects empty string', () => {
    expect(validateBranchName('')).not.toBeNull()
  })

  it('rejects whitespace-only string', () => {
    expect(validateBranchName('   ')).not.toBeNull()
  })

  // ── reserved names (case-sensitive) ───────────────────────────────────────

  it.each(['HEAD', 'FETCH_HEAD', 'ORIG_HEAD', 'MERGE_HEAD', 'CHERRY_PICK_HEAD'])(
    'rejects reserved name: %s',
    (name) => {
      expect(validateBranchName(name)).toMatch(/reserved/)
    }
  )

  // ── dot rules ─────────────────────────────────────────────────────────────

  it('rejects name starting with dot', () => {
    expect(validateBranchName('.hidden')).toMatch(/start or end with a dot/)
  })

  it('rejects name ending with dot', () => {
    expect(validateBranchName('feature.')).toMatch(/start or end with a dot/)
  })

  it('rejects a single dot', () => {
    expect(validateBranchName('.')).toMatch(/start or end with a dot/)
  })

  it('rejects name ending with .lock', () => {
    expect(validateBranchName('config.lock')).toMatch(/\.lock/)
  })

  it('rejects name containing consecutive dots', () => {
    expect(validateBranchName('feat..update')).toMatch(/\.\./)
  })

  // ── rule ordering: first matching rule wins ────────────────────────────────

  it('starts-with-dot fires before ends-with-.lock for ".lock"', () => {
    // ".lock" triggers the dot rule, not the .lock rule
    expect(validateBranchName('.lock')).toMatch(/start or end with a dot/)
  })

  it('dot rule fires for "HEAD." because reserved check is an exact match', () => {
    // "HEAD." is not in the reserved set — dot rule fires first
    expect(validateBranchName('HEAD.')).toMatch(/start or end with a dot/)
  })

  it('consecutive-dot rule fires before hyphen-start for "..bar"', () => {
    // starts with dot fires before .., but worth confirming "..bar" is still rejected
    expect(validateBranchName('..bar')).not.toBeNull()
  })

  // ── whitespace / control chars ────────────────────────────────────────────

  it('rejects name with a space', () => {
    expect(validateBranchName('my branch')).toMatch(/spaces or control characters/)
  })

  it('rejects name with a tab character', () => {
    expect(validateBranchName('my\tbranch')).toMatch(/spaces or control characters/)
  })

  it('rejects name with a newline', () => {
    expect(validateBranchName('my\nbranch')).toMatch(/spaces or control characters/)
  })

  it('rejects name with NUL byte (\\x00)', () => {
    expect(validateBranchName('bad\x00name')).toMatch(/spaces or control characters/)
  })

  it('rejects name with low control character (\\x01)', () => {
    expect(validateBranchName('bad\x01name')).toMatch(/spaces or control characters/)
  })

  it('rejects name with highest control character DEL (\\x7f)', () => {
    expect(validateBranchName('bad\x7fname')).toMatch(/spaces or control characters/)
  })

  // ── special characters ────────────────────────────────────────────────────

  it.each(['~', '^', ':', '?', '*', '[', '\\'])(
    'rejects name containing forbidden special char: %s',
    (ch) => {
      expect(validateBranchName(`feat${ch}test`)).toMatch(/cannot contain/)
    }
  )

  // ── hyphen rules ──────────────────────────────────────────────────────────

  it('rejects name starting with a hyphen', () => {
    expect(validateBranchName('-bad-start')).toMatch(/cannot start with a hyphen/)
  })

  it('rejects a single hyphen', () => {
    expect(validateBranchName('-')).toMatch(/cannot start with a hyphen/)
  })

  it('accepts a hyphen in the middle', () => {
    expect(validateBranchName('my-feature')).toBeNull()
  })

  // ── @{ rule ───────────────────────────────────────────────────────────────

  it("rejects name containing '@{' in the middle", () => {
    expect(validateBranchName('feature@{upstream}')).toMatch(/@\{/)
  })

  it("rejects name that starts with '@{'", () => {
    expect(validateBranchName('@{reflog}')).toMatch(/@\{/)
  })

  // ── bare @ ────────────────────────────────────────────────────────────────

  it("rejects the bare '@' name", () => {
    expect(validateBranchName('@')).toMatch(/cannot be '@'/)
  })

  it("accepts '@' inside a longer name that isn't followed by '{'", () => {
    expect(validateBranchName('user@work')).toBeNull()
  })

  // ── slash rules ───────────────────────────────────────────────────────────

  it('rejects name ending with slash', () => {
    expect(validateBranchName('feature/')).toMatch(/cannot end with a slash/)
  })

  it('rejects name with consecutive slashes', () => {
    expect(validateBranchName('feat//update')).toMatch(/consecutive slashes/)
  })

  it('accepts single slash as path separator', () => {
    expect(validateBranchName('feature/cool')).toBeNull()
  })
})

describe('extractJiraKey', () => {
  it('extracts key from Atlassian browse URL', () => {
    expect(extractJiraKey('https://myteam.atlassian.net/browse/PROJ-123')).toBe('PROJ-123')
  })

  it('extracts key from URL with query params', () => {
    expect(extractJiraKey('https://myteam.atlassian.net/browse/PROJ-123?focusedId=456')).toBe('PROJ-123')
  })

  it('extracts key from URL with hash fragment', () => {
    expect(extractJiraKey('https://myteam.atlassian.net/browse/AB-1#comment')).toBe('AB-1')
  })

  it('accepts raw uppercase key', () => {
    expect(extractJiraKey('PROJ-123')).toBe('PROJ-123')
  })

  it('uppercases lowercase key input', () => {
    expect(extractJiraKey('proj-123')).toBe('PROJ-123')
  })

  it('handles mixed-case key', () => {
    expect(extractJiraKey('Proj-123')).toBe('PROJ-123')
  })

  it('handles 2-letter project key (minimum)', () => {
    expect(extractJiraKey('AB-1')).toBe('AB-1')
  })

  it('handles 10-letter project key (maximum)', () => {
    expect(extractJiraKey('ABCDEFGHIJ-999')).toBe('ABCDEFGHIJ-999')
  })

  it('returns null for empty input', () => {
    expect(extractJiraKey('')).toBeNull()
  })

  it('returns null for whitespace-only input', () => {
    expect(extractJiraKey('   ')).toBeNull()
  })

  it('returns null for random text', () => {
    expect(extractJiraKey('not-a-key')).toBeNull()
  })

  it('returns null for URL without browse path', () => {
    expect(extractJiraKey('https://google.com')).toBeNull()
  })

  it('returns null for single-letter project key', () => {
    expect(extractJiraKey('A-123')).toBeNull()
  })

  it('returns null for key with digits in project part', () => {
    expect(extractJiraKey('US1-123')).toBeNull()
  })

  it('trims whitespace around input', () => {
    expect(extractJiraKey('  PROJ-123  ')).toBe('PROJ-123')
  })
})

describe('deriveBranchFromJira', () => {
  it('creates branch from key + summary', () => {
    expect(deriveBranchFromJira('PROJ-123', 'Fix cart total calculation'))
      .toBe('PROJ-123-fix-cart-total-calculation')
  })

  it('handles special characters in summary', () => {
    expect(deriveBranchFromJira('PROJ-456', 'Fix: "cart" total (v2) & shipping'))
      .toBe('PROJ-456-fix-cart-total-v2-shipping')
  })

  it('collapses multiple consecutive special chars into single hyphen', () => {
    expect(deriveBranchFromJira('KEY-1', 'foo --- bar'))
      .toBe('KEY-1-foo-bar')
  })

  it('truncates long summaries to keep slug at 60 chars', () => {
    const long = 'a'.repeat(100)
    const result = deriveBranchFromJira('KEY-1', long)
    expect(result).toBe('KEY-1-' + 'a'.repeat(60))
  })

  it('strips trailing hyphens after truncation', () => {
    // Create a summary that, after slugification and truncation, would end with a hyphen
    const summary = 'a'.repeat(59) + ' end'
    const result = deriveBranchFromJira('KEY-1', summary)
    expect(result.endsWith('-')).toBe(false)
  })

  it('falls back to key-only when summary is entirely non-ASCII', () => {
    expect(deriveBranchFromJira('PROJ-123', 'カート合計の修正')).toBe('PROJ-123')
  })

  it('falls back to key-only for empty summary', () => {
    expect(deriveBranchFromJira('PROJ-123', '')).toBe('PROJ-123')
  })

  it('handles summary with mixed ASCII and non-ASCII', () => {
    expect(deriveBranchFromJira('KEY-1', 'Fix カート total'))
      .toBe('KEY-1-fix-total')
  })

  it('strips leading hyphens from slug', () => {
    expect(deriveBranchFromJira('KEY-1', '!!!fix bug'))
      .toBe('KEY-1-fix-bug')
  })

  it('produces valid git branch names', () => {
    const result = deriveBranchFromJira('PROJ-123', 'Fix cart total calculation')
    expect(validateBranchName(result)).toBeNull()
  })
})
