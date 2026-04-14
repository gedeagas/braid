---
sidebar_position: 2
title: Code Review & PR Workflow
---

# Code Review & PR Workflow

Braid gives you a complete Git-to-GitHub pipeline without leaving the app. You make changes, review diffs, commit with AI-generated messages, push, create a pull request, monitor CI checks, and merge — all from one window. Here is how the full cycle works.

## Review Your Changes

Before you commit anything, open the **Changes** tab in the right panel. You see a full diff view showing every file you have modified, added, or deleted in the current worktree.

- **Added lines** are highlighted in green; **removed lines** in red.
- Click any file name to expand or collapse its diff.
- Use this view to catch accidental changes, leftover debug statements, or files you did not mean to modify.

:::tip
Make it a habit to review your diffs before every commit. It takes ten seconds and catches mistakes that would otherwise end up in your Git history permanently.
:::

## Stage and Commit

Once you are satisfied with your changes, you can commit directly through Claude or through the integrated terminal.

When you ask Claude to commit your changes, it:

1. Analyzes the staged diff to understand what changed and why.
2. Generates a commit message that summarizes the intent — not just the files touched.
3. Creates the commit.

You can also use the terminal tab to run `git add` and `git commit` manually if you prefer full control.

:::note
AI-generated commit messages focus on the "why" rather than the "what." Instead of "update auth.ts," you get something like "add token refresh logic to prevent silent session expiry." You can always edit the message before confirming.
:::

## Push to Remote

After committing, push your branch. You can do this through Claude ("push my changes") or through the terminal. If your branch does not have an upstream tracking branch yet, Braid handles the `-u` flag automatically.

You can also set or change the upstream tracking branch from the **BranchBar** at the top of the center panel. Click the upstream dropdown to pick a different remote branch.

## Create a Pull Request

Click the **Create PR** button in the Checks tab, or ask Claude to create one for you. Braid generates the pull request using your commit history:

- The **title** is derived from your branch name or commit summary.
- The **description** is AI-generated from your commits, summarizing the changes and their purpose.

You can edit both before submitting. The PR is created via the `gh` CLI, so it respects your repository's templates and branch protection rules.

:::tip
If your project uses a PR template, Braid respects it. The AI-generated description fills in the template sections where possible, so you spend less time on boilerplate.
:::

## Monitor CI Checks

Once your PR is open, switch to the **Checks** tab in the right panel. You see every CI check associated with your pull request:

- **Status indicators** show pending, passing, and failing checks in real time.
- The view **auto-refreshes**, so you do not need to keep reloading.
- Click a failing check to see its details and logs.

If a check fails, you can jump straight back to your code, fix the issue, commit, and push. The Checks tab updates automatically as your new commits trigger fresh CI runs.

## Merge Your Pull Request

When all checks pass and you have the required approvals, you can merge directly from Braid. The merge bar at the bottom of the Checks tab lets you:

- **Choose a merge strategy**: merge commit, squash, or rebase.
- **Confirm and merge** with a single click.

Braid calls the GitHub API through `gh`, so the merge respects your repository's branch protection rules, required reviewers, and status checks.

## Clean Up After Merge

After your PR is merged, the branch is no longer needed. You can:

1. **Delete the remote branch** — Braid offers this option right after merge.
2. **Remove the worktree** — right-click it in the sidebar and select **Remove Worktree**.

This keeps your sidebar and your repository clean. Session history for the worktree is preserved separately, so you can always go back and reference past conversations.

## Review a Teammate's PR

You are not limited to your own pull requests. To review someone else's work:

1. Create a new worktree from their branch.
2. Open the Changes tab to see their diffs.
3. Start a Claude session to discuss the code, ask questions, or suggest improvements.

This gives you a full local environment for the PR — you can run the code, run tests, and verify behavior before approving.

:::note
The entire workflow requires the GitHub CLI (`gh`) installed and authenticated. Braid uses it for all GitHub operations. Run `gh auth status` in a terminal to verify your setup.
:::
