---
sidebar_position: 7
title: Project Settings
---

# Project Settings

Right-click a project in the sidebar and select **Project Settings** to configure per-project overrides, file copying, and lifecycle scripts.

## Project overrides

These settings override the corresponding global defaults for this project only.

| Option | Description |
|---|---|
| **Worktrees path** | Storage directory for this project's worktrees. Overrides the global worktree storage path. |
| **Default base branch** | The branch used as the starting point when you create a new worktree (e.g., `main`, `develop`). |
| **Branch prefix** | A string prepended to new branch names in this project. Overrides the global branch prefix. |
| **Remote origin** | The remote used for fetching branches and pushing changes. |

## Copy files on worktree creation

When you create a worktree, Braid offers to copy files from the source worktree. This list combines two sources:

- **Saved files** -- files you have manually added to the copy list.
- **Discovered files** -- files found by your global discovery patterns (see [Git settings](./git.md)).

Each file has a toggle so you can include or exclude it per creation. Add files manually by clicking the **+** button and entering a path or pattern.

## Lifecycle scripts

Lifecycle scripts run automatically at specific points in a worktree's life.

| Script | When it runs | Example use |
|---|---|---|
| **Setup** | Immediately after worktree creation. | `yarn install`, `cp .env.example .env` |
| **Run** | On demand when you click the Run button. | `yarn dev`, `make serve` |
| **Archive** | When you delete the worktree. | Cleanup temp files, close connections |

Scripts run in the worktree's root directory inside Braid's integrated terminal.

## Utilities

| Button | Action |
|---|---|
| **Open in Finder** | Open the project's root directory in Finder. |
| **Copy path** | Copy the project's root path to the clipboard. |

## Tips

- Setup scripts are ideal for bootstrapping dependencies so every new worktree is ready to use immediately.
- If a lifecycle script fails, the worktree is still created (or deleted). Check the terminal output for errors.
