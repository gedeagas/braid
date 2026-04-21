---
sidebar_position: 1
title: Projects & Worktrees
description: Organize work around Git repositories and isolated worktrees for parallel development in Braid.
---

# Projects & Worktrees

Braid organizes your work around two core concepts: **projects** and **worktrees**. A project is a Git repository. A worktree is an isolated working directory that branches from that same repository, letting you run multiple tasks in parallel without switching branches.

## Add a project

Open Braid and click **Add Project** in the sidebar. Select a local Git repository from your filesystem. Braid reads the repo's remote origin and branch structure, then displays it in the sidebar alongside your other projects.

You can drag projects up and down in the sidebar to reorder them however you like.

## Create a worktree

Click the **Add Worktree** button next to your project name. A dialog appears with two fields:

1. **Remote branch** — Pick the branch you want to base your work on from the searchable dropdown. This lists all branches on your remote origin (e.g., `origin/main`, `origin/develop`).
2. **Local branch name** — Braid auto-fills this from the remote branch name. If you want something different, type your own name or click the dice icon to generate a random Japanese city name.

:::tip
The dice icon picks from a curated list of Japanese city names like `onomichi`, `kamakura`, or `takayama`. It keeps branch names short and memorable when you don't have a specific naming convention.
:::

When you confirm, Braid runs the following Git command under the hood:

```bash
git worktree add -b <localBranch> <path> <originBranch>
```

Your new worktree is stored at `~/Braid/worktrees/{project}/{branch}/`. Each worktree gets its own complete working directory, so you can have Claude editing code in one branch while you review changes in another.

## Navigate the sidebar

The sidebar shows all your projects and their worktrees in a hierarchical list. Each worktree displays a **status indicator** that tells you what's happening at a glance:

| Indicator | Meaning |
|-----------|---------|
| Green dot | Idle — no active Claude session |
| Spinning | Running — Claude is actively working |
| Orange dot | Waiting — Claude needs your input |
| Red dot | Error — something went wrong |

If a worktree has an open pull request, you see a **PR badge** with the PR number next to the branch name.

:::note
Status indicators update in real time. If Claude finishes a task while you're looking at another worktree, you see the indicator change immediately.
:::

## Keyboard navigation

You can navigate the sidebar entirely with the keyboard:

| Key | Action |
|-----|--------|
| **↑ / ↓** | Move focus through worktrees and project headers |
| **←** on a worktree | Jump focus to its parent project header |
| **←** on an expanded project | Collapse the project |
| **→** on a collapsed project | Expand the project |
| **→** on an expanded project | Move focus to its first worktree |
| **Enter / Space** | Select the focused worktree or toggle the project |

Clicking a row with the mouse syncs the keyboard focus position, so subsequent arrow navigation resumes from where you clicked. Arrow keys are disabled when a text input or button has focus, so they never interfere with typing in the chat input.

## Pin worktrees

Right-click any worktree and select **Pin** from the context menu. Pinned worktrees float to the top of their project group, so your most important branches stay visible no matter how many worktrees you have.

## Use the context menu

Right-click a worktree to access these actions:

- **Pin / Unpin** — Toggle whether the worktree stays at the top.
- **Copy branch name** — Put the branch name on your clipboard for use in terminal commands or PR descriptions.
- **Refresh** — Re-scan the worktree's Git state.
- **Open in...** — Open the worktree folder in an external application (Finder, Terminal, VS Code, Cursor, etc.). Braid detects which apps are installed on your system and shows them in a submenu.
- **Delete** — Remove the worktree from disk and from Braid. This runs `git worktree remove` and cleans up the directory.

## Configure project settings

Click the gear icon next to a project name to open project settings. Here you configure behaviors that apply to every worktree created under this project.

### Lifecycle scripts

Define shell commands that run at specific points in a worktree's life:

- **Setup** — Runs when a new worktree is created. Use this to install dependencies, set up environment files, or run database migrations.
- **Run** — The command that starts your development server. Braid executes this in the worktree's integrated terminal.
- **Archive** — Runs before a worktree is deleted. Use this to clean up resources or push final changes.

### Copy files on creation

Specify files or directories that get copied into every new worktree. This is useful for configuration files that aren't checked into Git, like `.env` files or local settings.

### Branch prefix

Set a prefix that gets prepended to every new local branch name. If you set the prefix to `feature/`, a branch named `login-flow` becomes `feature/login-flow`.

### Remote origin

View and change the remote origin URL for the project. This controls which remote's branches appear in the worktree creation dialog.

:::tip
If your team uses a branch naming convention like `yourname/feature-description`, set the branch prefix to your name followed by a slash. Every new worktree automatically follows the convention.
:::

## Work across multiple worktrees

The real power of worktrees shows up when you run multiple tasks simultaneously. You might have Claude implementing a feature in one worktree, fixing a bug in another, and writing tests in a third — all within the same repository, all at the same time.

Switch between worktrees by clicking them in the sidebar. Each worktree maintains its own Claude sessions, terminal state, and open files independently. Nothing bleeds across.

When you finish work in a worktree, you can create a PR directly from Braid's Checks panel, then delete the worktree to keep your workspace clean.
