---
sidebar_position: 4
title: Git
---

# Git

Open Settings with **Cmd+,** and select the **Git** tab to configure branch naming, worktree storage, and file discovery for new worktrees.

## Options

| Option | Description | Details |
|---|---|---|
| **Default branch name prefix** | A string prepended to every new branch name you create. Use this to namespace branches by author or team. | Example: `yourname/`, `feat/` |
| **Worktree storage path** | The root directory where Braid stores worktree checkouts. Each project gets a subdirectory, and each worktree gets a folder inside that. | Default: `~/Braid/worktrees/` |
| **Discovery patterns** | Filename patterns that Braid looks for in the main worktree when creating a new worktree. Matched files are offered for automatic copying into the new worktree. Supports wildcards. | Example: `.env*`, `.tool-versions`, `local.properties` |

## How discovery patterns work

When you create a worktree, Braid scans the source worktree for files matching your discovery patterns. Matched files appear in a checklist so you can choose which ones to copy. This is useful for environment files, local configuration, and secrets that are not committed to Git.

Pattern examples:

| Pattern | Matches |
|---|---|
| `.env*` | `.env`, `.env.local`, `.env.development` |
| `*.local` | `settings.local`, `config.local` |
| `.tool-versions` | Exact filename match |

## Tips

- The branch prefix is concatenated directly with the branch name. If you want a separator, include it in the prefix (e.g., `yourname/` not `yourname`).
- Changing the worktree storage path does not move existing worktrees. You need to re-add them from the new location.
- Discovery patterns are checked at worktree creation time only. They do not sync files after the worktree exists.
