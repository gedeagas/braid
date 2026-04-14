---
sidebar_position: 8
title: Git Changes
---

# Git Changes

The **Changes** tab in the right panel gives you a complete git staging and commit workflow. You review diffs, stage files, write commit messages, and push to your remote without leaving Braid.

## View modified files

Open the **Changes** tab to see all files with uncommitted changes. The view splits files into two collapsible sections:

- **Staged Changes**: files added to the git index, ready to commit
- **Unstaged Changes**: modified, added, or untracked files not yet staged

Each file shows a status badge indicating what changed:

| Badge | Meaning |
|-------|---------|
| **M** | Modified |
| **A** | Added |
| **D** | Deleted |
| **R** | Renamed |
| **?** | Untracked |

The toolbar at the top displays a summary count of staged and unstaged files. Click **Refresh** to manually reload the status. The view also auto-refreshes every 10 seconds.

## Review diffs

Click any file in the list to expand its diff inline. The diff viewer shows syntax-highlighted changes with line numbers for both the old and new versions.

- **Green lines** with a `+` gutter mark are additions
- **Red lines** with a `-` gutter mark are deletions
- **Gray lines** are unchanged context

Each diff hunk includes a header showing the line range and the surrounding function or class name when available. A stats summary at the top of the diff shows the total additions and deletions.

Click the file again (or click the close button on the diff pane) to collapse it.

:::tip
Use the diff viewer to review Claude's changes before committing. After an agentic session modifies your code, switch to the Changes tab to see exactly what changed.
:::

## Stage and unstage files

You control what goes into each commit by staging and unstaging files.

- **Stage a single file**: Click the checkbox next to an unstaged file. A checkmark appears and the file moves to the Staged section.
- **Unstage a single file**: Click the checked checkbox next to a staged file. The file moves back to Unstaged.
- **Stage all**: Click the **Stage All** button in the Unstaged section header.
- **Unstage all**: Click the **Unstage All** button in the Staged section header.

Both sections are collapsible. Click the section header to toggle visibility when you want to focus on one group.

## Discard changes

To throw away modifications to a file, click the discard button (the X icon) on the right side of an unstaged file row. A confirmation banner appears asking you to confirm the action.

:::note
Discarding changes is permanent. The file reverts to its last committed state and you cannot undo this action.
:::

## Write a commit message

The commit box sits at the top of the Changes tab, below the toolbar. Type your message directly into the text area.

You can also let AI write the message for you. Click the **Generate** button (marked with a sparkle icon) to have Claude analyze your staged changes and produce a commit message. The message types itself into the text area with a typing animation. If you want a different message, click **Regenerate** to try again.

:::tip
The AI commit message generator only looks at staged changes. Stage your files first, then generate the message for the most accurate result.
:::

## Commit your changes

Once you have staged files and a commit message, click **Commit**. The button shows the number of staged files so you know exactly what you are committing.

You can also press **Cmd+Enter** (or Ctrl+Enter) inside the commit message box to commit without clicking.

After a successful commit, the button briefly shows a success indicator and the file list refreshes. If something goes wrong, an error message appears below the commit box with details.

## Clean working tree state

When your working tree has no changes, the Changes tab switches to an **empty state** view. This clean-state screen shows:

- An animated **NekoWalk** — a walking ASCII cat that crosses the screen, adding personality to an otherwise static view
- A green checkmark confirming the tree is clean
- A **Pull** button to fetch updates from the remote

### Pull from remote

The pull button label shows which upstream branch it will pull from (e.g., "Pull from origin/main"). If there is no upstream tracking branch configured, the button is disabled with a tooltip explaining why.

Pull results appear inline:

- **Already up to date**: a brief success message that auto-dismisses
- **New changes pulled**: the file list refreshes automatically
- **Error**: the error message displays below the button for 5 seconds

## Push to remote

The push workflow is available in the **Checks** tab alongside PR management. See the [PR & Checks](./pr-checks) page for details on pushing commits and syncing with your remote.

## Keyboard shortcuts

| Action | Shortcut |
|--------|----------|
| Commit | Cmd+Enter (in message box) |
