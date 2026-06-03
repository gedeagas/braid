// Jira helpers for the create-worktree flow. Ported from the desktop's
// `src/renderer/lib/branchValidation.ts` so mobile derives identical branch
// names from a resolved ticket. Metro can't resolve outside `mobile-app/`, so
// keep these in sync with the desktop versions if they change.

/** The subset of the desktop `JiraIssue` the mobile lookup card needs. */
export interface JiraIssueLite {
  key: string;
  summary: string;
  type: string;
  status: string;
  statusCategory: 'new' | 'indeterminate' | 'done';
}

/**
 * Extract a Jira issue key from user input.
 * Accepts a raw key ("PROJ-123") or an Atlassian browse URL
 * ("https://company.atlassian.net/browse/PROJ-123"). Returns the uppercase key,
 * or null when no valid key is found.
 */
export function extractJiraKey(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const urlMatch = trimmed.match(/\/browse\/([A-Z]{2,10}-\d+)/i);
  if (urlMatch) return urlMatch[1].toUpperCase();

  const keyMatch = trimmed.match(/^([A-Z]{2,10}-\d+)$/i);
  if (keyMatch) return keyMatch[1].toUpperCase();

  return null;
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
    .replace(/-+$/, '');

  if (!slug) return key;
  return `${key}-${slug}`;
}
