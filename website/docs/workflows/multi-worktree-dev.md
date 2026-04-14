---
sidebar_position: 1
title: Parallel Development with Worktrees
description: Work on multiple features simultaneously using isolated Git worktrees, each with its own terminals and Claude sessions.
---

# Parallel Development with Worktrees

Switching branches mid-task means stashing changes, losing terminal state, and rebuilding mental context when you come back. Braid eliminates that friction entirely. You create isolated worktrees — each with its own file tree, terminals, and Claude sessions — and work on multiple features at the same time without ever leaving the app.

## Create a New Worktree

1. Right-click a project in the sidebar and select **Add Worktree**.
2. In the dialog, pick a **source branch** from the remote origin dropdown. Braid fetches all available remote branches so you always start from the latest state.
3. Name your local branch. Braid auto-fills the name by stripping the `origin/` prefix. If you want something different, click the dice button to generate a random name.
4. Click **Create**. Braid runs `git worktree add` under the hood and your new worktree appears in the sidebar immediately.

Your worktree lives at `~/Braid/worktrees/{project}/{branch}/`, completely separate from every other worktree in the project.

:::tip
You can create worktrees from any remote branch, not just `main`. This is useful when you need to branch off a long-lived feature branch or a release branch.
:::

## Work on Features in Parallel

Each worktree is a fully independent workspace. When you select a worktree in the sidebar, you get:

- **Its own file tree** in the right panel, reflecting only the files in that worktree's directory.
- **Its own terminals** that start in the worktree's root path. Terminal state persists even when you switch between worktrees.
- **Its own Claude sessions** with separate conversation histories and contexts.

You switch between worktrees by clicking them in the sidebar. There is no branch checkout, no stash, no rebuild. Everything is already there, exactly as you left it.

## The Hotfix Scenario

Here is a common workflow that shows why worktrees matter:

1. You are deep into `feature-auth-redesign`, halfway through a conversation with Claude about refactoring the login flow. Your terminal is running a dev server. You have unsaved edits in two files.
2. A critical bug report comes in. You need to patch `main` immediately.
3. You right-click the project, create a new worktree from `origin/main`, and name the branch `hotfix-cart-crash`.
4. You click into the new worktree. A fresh terminal opens at the worktree root. You start a new Claude session, describe the bug, and work through the fix.
5. You commit, push, create a PR, and merge — all from within Braid.
6. You click back to `feature-auth-redesign`. Your dev server is still running. Your Claude conversation is still there. Your unsaved edits are intact.

No stashing. No context switching. No lost state.

## Lifecycle Scripts

When Braid creates a worktree, it can automatically run setup commands — installing dependencies, seeding a database, generating configuration files, or anything else your project needs to be ready.

You configure these in your project's setup panel. Common examples include:

- `yarn install` to pull dependencies
- Database migration or seed scripts
- Environment file generation

:::note
Lifecycle scripts run in the worktree's own terminal, so you can watch their output and catch errors immediately. If a script fails, the worktree is still created — you can fix the issue and re-run manually.
:::

## Pin Important Worktrees

If you have a worktree you return to frequently — your main development branch, a long-running feature, or a staging environment — you can pin it to the top of the sidebar. Right-click the worktree and select **Pin**. Pinned worktrees always float above unpinned ones, regardless of alphabetical order.

This keeps your most important workspaces one click away, even when a project has a dozen active worktrees.

## Clean Up When You Are Done

After you merge a feature branch or finish a hotfix, you can delete the worktree directly from the sidebar. Right-click it and select **Remove Worktree**. Braid removes the worktree directory and cleans up the Git reference. Your sessions for that worktree are preserved in case you need to reference them later.

:::tip
Get into the habit of cleaning up merged worktrees. Each worktree is a full copy of your repo's working directory, so they add up in disk space over time.
:::

## When to Use Worktrees

Worktrees shine when you need to:

- **Juggle multiple features** without losing terminal or editor state.
- **Review a teammate's PR** while your own work stays untouched.
- **Reproduce a bug on a specific branch** without disrupting your current environment.
- **Run long processes** (tests, builds, servers) on one branch while coding on another.

The overhead of creating a worktree is seconds. The overhead of context-switching without one is minutes — compounded every time you do it.
