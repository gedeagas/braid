# Jira Integration — Implementation Guide

> Analysis of the current Jira implementation in Braid. Use this as the baseline reference before making any changes or additions.

---

## Overview

Braid integrates with Jira via **acli** (Atlassian CLI) — no direct HTTP calls are made. The app extracts Jira issue keys from Git branch names, fetches issue details through acli, and displays them in the right panel's Checks tab. Authentication is fully delegated to acli's stored credentials.

---

## File Map

| Layer | File | Purpose |
|---|---|---|
| Backend Service | `src/main/services/jira.ts` | Core logic — acli calls, caching, key extraction |
| Main IPC | `src/main/ipc.ts` (lines 209-217) | IPC handler registration |
| Preload Bridge | `src/preload/index.ts` (lines 244-249) | Context-isolated bridge |
| Renderer IPC | `src/renderer/lib/ipc.ts` (lines 299-306) | Typed async wrappers |
| Types | `src/renderer/types/session.ts` (lines 174-192) | `JiraIssue`, `JiraResult` |
| Store | `src/renderer/store/ui/settings.ts` (lines 60, 113, 159, 268-271) | `jiraBaseUrl` state + setter |
| Storage Key | `src/renderer/lib/storageKeys.ts` (line 62) | `SK.jiraBaseUrl` |
| Branch Utils | `src/renderer/lib/branchValidation.ts` (lines 61-91) | `extractJiraKey()`, `deriveBranchFromJira()` |
| Checks View | `src/renderer/components/Right/ChecksView.tsx` (lines 154-196) | Polling + data fetch composition |
| Checks Sections | `src/renderer/components/Right/ChecksSections.tsx` (line 354) | Renders `JiraSection` |
| Issue Display | `src/renderer/components/Right/JiraSection.tsx` (lines 38-91) | Read-only issue list |
| Worktree Lookup | `src/renderer/components/Sidebar/JiraLookupField.tsx` (lines 18-130) | Interactive issue lookup |
| Add Worktree | `src/renderer/components/Sidebar/AddWorktreeDialog.tsx` (lines 207-216) | Conditionally shows lookup field |
| Settings | `src/renderer/components/Settings/SettingsJira.tsx` (lines 35-142) | acli install + base URL config |
| Docs | `website/docs/integrations/jira.md` | User-facing documentation |

---

## Data Flow

### Branch → Issues (Right Panel)

```
Git branch name
  └─► extract keys via regex [A-Z]{2,10}-\d+   (jira.ts:188)
        └─► acli jira workitem view KEY --json   (jira.ts:117)
              └─► parseIssue()                   (jira.ts:130)
                    └─► JiraResult { available, issues[] }
                          └─► ChecksView polls every 30-60s
                                └─► JiraSection renders read-only list
```

### Worktree Creation (Sidebar)

```
User pastes key / URL / focusedId param
  └─► extractJiraKey()                           (branchValidation.ts:61)
        └─► ipc.jira.getIssueByKey()
              └─► parseIssue()
                    └─► deriveBranchFromJira()   (branchValidation.ts:80)
                          └─► onResolved(issue, branch, validationError)
                                └─► AddWorktreeDialog applies branch name
```

---

## IPC API

All four IPC channels are wired through all three layers:

```typescript
// main process (ipc.ts)
ipcMain.handle('jira:isAvailable', ...)
ipcMain.handle('jira:recheckAvailability', ...)
ipcMain.handle('jira:getIssuesForBranch', (_, worktreePath, overrideBaseUrl?) => ...)
ipcMain.handle('jira:getIssueByKey', (_, key, overrideBaseUrl?) => ...)

// renderer usage (ipc.ts)
ipc.jira.isAvailable()
ipc.jira.recheckAvailability()
ipc.jira.getIssuesForBranch(worktreePath, overrideBaseUrl?)
ipc.jira.getIssueByKey(key, overrideBaseUrl?)
```

---

## Types

```typescript
// src/renderer/types/session.ts (lines 174-192)

interface JiraIssue {
  key: string              // e.g. "PROJ-123"
  summary: string          // issue title
  status: string           // human-readable, e.g. "In Progress"
  statusCategory: 'new' | 'indeterminate' | 'done'
  type: string             // e.g. "Story", "Bug"
  assignee: string | null
  url: string              // browser link to issue
}

interface JiraResult {
  available: boolean       // false when acli not installed
  issues: JiraIssue[]
}
```

---

## Base URL Detection

Priority order used in `jira.ts` (lines 56-88):

1. `overrideBaseUrl` argument (from settings store)
2. `~/.config/.jira/.config.yml` → `server:` field
3. `~/.config/jira/.config.yml` → `server:` field
4. `~/.jira/.config.yml` → `server:` field
5. `~/.jira.yml` → `server:` field
6. Falls back to empty string

---

## Caching

- Issue data cached for **5 minutes** using `ServiceCache<Record<string, unknown>>` (jira.ts:37)
- Cache is per-key; parallel fetches for multiple keys on one branch
- `recheckAvailability()` resets the acli availability flag (for post-install detection)
- No auto-refresh — stale until worktree switch or app restart

---

## UI Behaviour

### `JiraSection.tsx`
- **Silent** when acli not installed or no issues found (no empty state shown)
- Shows skeleton during loading
- Clickable issue rows → opens `issue.url` in browser
- Status badge colored by `statusCategory`: `new` / `indeterminate` / `done`
- Warning indicator shown when PR is `OPEN` but issue status is `'new'`

### `JiraLookupField.tsx`
- Accepts raw key (e.g. `PROJ-123`), full Atlassian URL, or URL with `focusedId` query param
- Deduplication: tracks last resolved key to prevent repeated lookups
- Monotonic counter guards against stale async responses
- Shows: loading spinner → error message → resolved issue card preview

### `ChecksView.tsx`
- Fetches PR status + Jira issues in **parallel** (line 156-160)
- Polling interval: **30s** when checks pending, **60s** when settled
- Pauses polling on tab/window hide
- Caches last snapshot for instant render on worktree switch (lines 44-53)

---

## Settings

`SettingsJira.tsx` provides:
- acli availability check on mount
- Install button linking to acli docs
- Base URL input field — persisted to `localStorage` via `SK.jiraBaseUrl`
- Save confirmation flash feedback

State managed in `src/renderer/store/ui/settings.ts`:
```typescript
jiraBaseUrl: string           // loaded from localStorage
setJiraBaseUrl(url: string)   // updates Zustand + localStorage
```

---

## Branch Name Utilities (`branchValidation.ts`)

```typescript
// Parse key from: raw key, URL path, or URL ?focusedId= param
extractJiraKey(input: string): string | null   // lines 61-74

// Generate branch slug: "{key}-{slugified-summary}" max 60 chars
deriveBranchFromJira(key: string, summary: string): string  // lines 80-91
```

---

## Known Gaps

| # | Gap | Impact |
|---|---|---|
| 1 | **Read-only** — cannot update issue status from Braid | Must switch to Jira UI to move cards |
| 2 | **No auth error distinction** — all failures (not installed / auth failed / network error) return `null` | Silent failures, hard to diagnose |
| 3 | **5-min cache, no auto-refresh** — stale status until worktree switch | Shown status may not reflect reality |
| 4 | **No offline state** — shows skeleton indefinitely when offline | Confusing UX |
| 5 | **Single issue per worktree creation** — only one lookup in AddWorktreeDialog | Multi-issue workflows not supported in creation flow |
| 6 | **No reverse lookup** — cannot go from Jira → auto-create worktree | Must manually type/paste key |
| 7 | **Multi-key branches are display-only** — multiple keys detected in panel but not manageable | No UI to add/remove linked issues |

---

## Conventions to Follow When Extending

- All new Jira IPC must be threaded through all 3 layers: `ipc.ts` → `preload/index.ts` → `renderer/lib/ipc.ts`
- New UI components go in `Right/` (display) or `Sidebar/` (creation flow) following existing naming
- Any new settings fields must be added to `SettingsJira.tsx`, `store/ui/settings.ts`, and all three locale files (`en/`, `ja/`, `id/` under `settings.json`)
- Use `ServiceCache` for any new server-side caching in `jira.ts`
- Status colors must use design tokens — never hardcode hex values
- Keep `jira.ts` under 450 lines; decompose to a `jira/` directory module if it grows
