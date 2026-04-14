---
sidebar_position: 2
title: Add Your First Project
---

# Add Your First Project

A project in Braid maps to a Git repository. You can add one from a local path or a GitHub URL.

## Option A: Add from a local path

Use this when you already have a repository cloned on your machine.

1. Click **Add Project** in the left sidebar.
2. Select the **Local Path** tab.
3. Browse to an existing Git repository on your machine.
4. Click **Add**.

The project appears in the sidebar immediately. Braid detects the main worktree and lists it under the project.

## Option B: Add from a GitHub URL

Use this when you want Braid to clone a repository for you.

1. Click **Add Project** in the sidebar.
2. Select the **GitHub URL** tab.
3. Paste the repository URL (e.g., `https://github.com/owner/repo`).
4. Click **Add**.

Braid clones the repository into `~/Braid/worktrees/` and sets it up automatically.

:::tip
The GitHub URL method requires `gh` to be installed and authenticated. See the [Installation](./installation.md) page for setup instructions.
:::

## Understand the three-panel layout

Once you add a project, you see the full Braid workspace. It has three panels:

### Left sidebar

The sidebar shows your projects and their worktrees. Click a worktree to select it. You can:

- Pin worktrees to keep them at the top of the list
- Drag to reorder projects and worktrees
- Right-click for context menu options

### Center panel

The center panel is where you work. It serves two purposes:

- **Chat sessions** -- Interact with Claude in threaded conversations. Each worktree can have multiple independent sessions.
- **File editor** -- Open and edit files with syntax highlighting. Tabs appear alongside chat sessions in the tab bar.

### Right panel

The right panel gives you project context at a glance:

- **Files tab** -- Browse the file tree for the selected worktree
- **Changes tab** -- View staged and unstaged git changes with diffs
- **Checks tab** -- Monitor pull request CI checks and status
- **Terminal** -- Run commands in an integrated terminal with multiple tabs

:::note
You can resize each panel by dragging the dividers between them. The app remembers your preferred layout.
:::

## What happens next

After you add a project, the main worktree appears in the sidebar. Select it to open a chat session and start working with Claude.

You can create additional worktrees from the sidebar to work on multiple branches in parallel. Each worktree gets its own chat sessions, file tree, and terminal.

Ready to talk to Claude? Head to [Send Your First Message](./first-chat.md).
