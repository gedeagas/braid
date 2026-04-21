---
sidebar_position: 9
title: PR & Checks
---

# PR & Checks

The **Checks** tab in the right panel connects your branch to GitHub. You monitor pull requests, track CI check runs, view deployments, and manage your branch's sync status from one place.

## Detect pull requests automatically

When you switch to the Checks tab, Braid uses the GitHub CLI (`gh`) to look up any open pull request for the current branch. If a PR exists, it loads the full details: title, number, state, mergeable status, and associated checks.

If no PR exists for the branch, you see a prompt to create one.

## Create a pull request

Click the **Create PR** button on the empty state screen. Braid opens a new Claude chat session and sends a structured prompt that tells Claude to:

1. Push the branch to origin if it does not have a remote upstream yet
2. Look for a PR template in your repository (`.github/pull_request_template.md` and similar locations)
3. Review all commits on the branch
4. Create the PR with `gh pr create`, following the template if one exists

Claude handles the entire flow autonomously. Once done, the Checks tab picks up the new PR on its next refresh.

:::tip
If your repository uses a PR template, Claude fills in each section based on the actual changes. You get a well-structured description without writing it yourself.
:::

## PR merge bar

When a PR is open, the merge bar appears at the top of the right panel. It shows:

- **PR number**: Click it to open the PR on GitHub in your browser.
- **Mergeable status**: A colored dot indicates whether the PR is ready to merge (green), has conflicts (red), or is still being checked (amber).
- **Draft state**: If the PR is a draft, a **Mark as Ready** button replaces the merge controls.

### Merge your PR

Click the **Merge** button to open a dropdown with three strategies:

| Strategy | Description |
|----------|-------------|
| **Merge commit** | Creates a merge commit preserving all individual commits |
| **Squash and merge** | Combines all commits into a single commit on the base branch |
| **Rebase and merge** | Replays your commits on top of the base branch |

Select a strategy and the merge executes immediately. The PR status updates to reflect the merge.

:::note
The Merge button is disabled when the PR has conflicts or is still in draft state. Resolve conflicts or mark the PR as ready first.
:::

## Git sync status

For open PRs, the Checks tab displays a git status section that tracks three things:

- **Uncommitted changes**: Shows the count of dirty files and a link to the Changes tab where you can commit them.
- **Commits behind**: Shows how many commits your branch is behind the base branch, with a **Pull** button to catch up.
- **Commits ahead**: Shows unpushed commits with a **Push** button to sync them to the remote.

Each row has a colored status dot. Green means everything is in sync. Amber means action is needed.

:::tip
Keep an eye on the "behind" count. If the base branch has moved ahead, pull before merging to avoid conflicts.
:::

## Check runs

The checks section lists every CI check run associated with the PR. Each check shows:

- **Status icon**: A green checkmark for success, red X for failure, gray circle for skipped, or a spinner for in-progress checks.
- **Check name**: The name of the workflow step or status check.
- **Duration or status**: Completed checks show how long they took. Pending checks show their current status.

Checks are grouped by workflow name when multiple steps belong to the same workflow.

### View check logs

Click any check run to download and open its log file in the center panel's file editor. This lets you read the full CI output without leaving Braid.

### Fix failed checks with AI

When a check fails, a **Fix with AI** button appears on that row. Click it to:

1. Download the CI failure log
2. Open a new Claude chat session
3. Send the log to Claude with a prompt to investigate and fix the root cause

Claude reads the log, finds the failing code, and applies a fix. You can then review the changes in the Changes tab and push them.

## Deployments

If your repository has deployment environments (such as staging or production), the Checks tab shows a deployments section. Each deployment displays:

- **Environment name**: such as "staging" or "production"
- **State indicator**: colored dot showing success, failure, or pending
- **Link**: Click the row to open the deployment URL in your browser

## Code reviews

When your PR has code reviews, Braid surfaces them in two places.

### Reviews summary in the Checks tab

A **Code Reviews** section appears below the check runs when reviewers have left feedback. Each row shows:

- **Reviewer avatar and name** - The person who submitted the review.
- **Review state badge** - Approved, changes requested, commented, or dismissed.
- **Thread counts** - How many comment threads are resolved vs. unresolved.

Reviews are deduplicated to show only the latest review per author.

### Full code review panel

Click **See all** or any review row to open the full code review panel in the center area. This view provides:

- **Filter bar** - Toggle between All, Open, and Resolved comment threads.
- **File-grouped comments** - Inline comments are organized by file path, each showing the relevant diff hunk with syntax highlighting (powered by Shiki).
- **Comment threading** - Reply chains are rendered inline beneath each diff hunk.
- **Click to open file** - Click any file path header to jump to that file in the editor.

The code review panel opens as a tab in the center panel, so you can switch between it and your chat sessions freely.

:::tip
Use the filter bar to focus on unresolved comments when addressing reviewer feedback. Switch to "All" to see the full conversation history.
:::

## PR status caching

Braid caches PR status per worktree to keep the UI responsive. The cache refreshes automatically every **60 seconds** in the background. Concurrent fetch requests for the same worktree are deduplicated, so even if multiple components request PR data simultaneously, only one GitHub API call is made.

## Auto-refresh and polling

The Checks tab polls GitHub automatically to keep the display current:

- **Open PRs with pending checks**: Refreshes every 30 seconds so you see check results as soon as they finish.
- **Open PRs with all checks settled**: Refreshes every 60 seconds.
- **Merged or closed PRs**: Polling stops entirely since the state is terminal.

Polling pauses when the browser tab or window is not visible and resumes immediately when you return. The footer shows the last updated timestamp so you always know how fresh the data is.

:::note
The Checks tab requires the GitHub CLI (`gh`) to be installed and authenticated. Make sure you have run `gh auth login` before using these features.
:::
