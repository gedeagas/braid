---
sidebar_position: 2
title: Jira
---

# Jira Integration

Braid automatically detects Jira issue keys in your branch names and displays the linked issues in the right panel. You see ticket status, summary, and assignee at a glance without switching to your browser.

## Prerequisites

Jira integration requires **acli** (Atlassian CLI). Install it and authenticate with your Jira instance:

```bash
# Verify acli is installed
which acli
```

If acli is not found, the Jira section is hidden in the UI. Braid checks for acli availability once per app session.

## Branch naming convention

Braid extracts Jira issue keys from your branch name using the standard `PROJECT-123` pattern. The project key must be 2-10 uppercase letters followed by a hyphen and a number.

Examples of branch names that trigger detection:

| Branch name | Detected keys |
|-------------|---------------|
| `PROJ-456-fix-login-bug` | PROJ-456 |
| `feature/PROJ-789-new-dashboard` | PROJ-789 |
| `AB-12-and-CD-34-combined` | AB-12, CD-34 |

Detection is case-insensitive - `proj-456` in the branch name resolves to `PROJ-456`.

## View linked issues

The Jira section appears in the right panel when issues are detected. Each issue shows:

- **Issue key** - Clickable link that opens the issue in your browser.
- **Summary** - The issue title.
- **Status** - Current workflow status with a color-coded indicator (green for done, blue for in progress, gray for new).
- **Type** - Story, Bug, Task, etc.
- **Assignee** - Who the issue is assigned to, or unassigned.

## Warning badge

When you have an open pull request but the linked Jira issue has not been moved to an "in progress" state, Braid shows a warning indicator. This reminds you to update the ticket status so your team's board stays accurate.

## Jira base URL

Braid resolves the Jira URL in this priority order:

1. **Settings override** - A custom base URL you configure in project settings.
2. **API self link** - The URL returned by the Jira API itself (most reliable).
3. **jira-cli config** - Auto-detected from `~/.config/.jira/.config.yml` or similar config files.

If none of these are available, issue keys display without links.

:::tip
If your issue links open to the wrong Jira instance, set the base URL explicitly in **Settings > Project Settings** for your project.
:::

:::note
Issue data is cached for 5 minutes to avoid repeated API calls. Switching worktrees or restarting the app triggers a fresh fetch.
:::
