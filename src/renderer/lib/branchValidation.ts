/**
 * Returns the display name for a worktree — the last segment of its path.
 * Falls back to the branch name if the path is empty or malformed.
 */
export function worktreeName(path: string, fallback: string): string {
  return path.split('/').pop() || fallback
}

/**
 * Validates a git branch name according to git-check-ref-format rules.
 * Returns an error message string if invalid, or null if valid.
 */
export function validateBranchName(name: string): string | null {
  if (!name || !name.trim()) return 'Branch name cannot be empty'

  // Reserved names that cannot be used as branch names
  const RESERVED = new Set(['HEAD', 'FETCH_HEAD', 'ORIG_HEAD', 'MERGE_HEAD', 'CHERRY_PICK_HEAD'])
  if (RESERVED.has(name)) return `'${name}' is a reserved git name and cannot be used as a branch name`

  // Cannot start or end with a dot
  if (name.startsWith('.') || name.endsWith('.')) return 'Branch name cannot start or end with a dot'

  // Cannot end with .lock
  if (name.endsWith('.lock')) return "Branch name cannot end with '.lock'"

  // Cannot contain consecutive dots
  if (name.includes('..')) return "Branch name cannot contain '..'"

  // Cannot contain spaces or control characters
  if (/[\s\x00-\x1f\x7f]/.test(name)) return 'Branch name cannot contain spaces or control characters'

  // Cannot contain these special characters
  if (/[~^:?*\[\\]/.test(name)) return 'Branch name cannot contain: ~ ^ : ? * [ \\'

  // Cannot start with a hyphen
  if (name.startsWith('-')) return 'Branch name cannot start with a hyphen'

  // Cannot contain @{
  if (name.includes('@{')) return "Branch name cannot contain '@{'"

  // Cannot be '@' alone
  if (name === '@') return "Branch name cannot be '@'"

  // Cannot end with a slash
  if (name.endsWith('/')) return 'Branch name cannot end with a slash'

  // Cannot have consecutive slashes
  if (name.includes('//')) return 'Branch name cannot contain consecutive slashes'

  return null
}

/**
 * Extract a Jira issue key from user input.
 * Accepts:
 *   - Raw key: "PROJ-123"
 *   - Atlassian URL: "https://yourcompany.atlassian.net/browse/PROJ-123"
 *   - URL with query params: "https://...?focusedId=123"
 * Returns uppercase key or null if no valid key is found.
 */
export function extractJiraKey(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  // Try extracting from URL path: /browse/KEY-123
  const urlMatch = trimmed.match(/\/browse\/([A-Z]{2,10}-\d+)/i)
  if (urlMatch) return urlMatch[1].toUpperCase()

  // Try raw key pattern
  const keyMatch = trimmed.match(/^([A-Z]{2,10}-\d+)$/i)
  if (keyMatch) return keyMatch[1].toUpperCase()

  return null
}

/**
 * Derive a branch name from a Jira issue key + summary.
 * Example: ("PROJ-123", "Fix cart total calculation") -> "PROJ-123-fix-cart-total-calculation"
 */
export function deriveBranchFromJira(key: string, summary: string): string {
  const slug = summary
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')

  if (!slug) return key
  return `${key}-${slug}`
}
