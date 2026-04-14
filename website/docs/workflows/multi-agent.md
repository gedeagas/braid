---
sidebar_position: 4
title: Multi-Agent Orchestration
---

# Multi-Agent Orchestration

Braid enables a workflow where one Claude session spawns and coordinates other sessions across different worktrees. You start a primary session with a high-level task, and it breaks the work into independent subtasks that run in parallel on separate branches.

## When to use multi-agent

Multi-agent orchestration is useful when:

- A task naturally decomposes into independent pieces (e.g., "implement the API endpoint" and "write the frontend component").
- You want to parallelize work across branches to save time.
- A primary session needs to delegate a subtask without blocking its own progress.

For simple, sequential tasks, a single session is usually sufficient.

## How it works

1. **Primary session creates worktrees.** Claude uses `braid_create_worktree` to create new branches for each subtask.

2. **Primary session spawns sessions.** Claude uses `braid_create_session` to start new Claude sessions on the created worktrees, each with its own prompt describing the subtask.

3. **Spawned sessions work independently.** Each session reads code, makes edits, and runs commands in its own worktree. They do not interfere with each other or the primary session.

4. **Primary session monitors progress.** Claude uses `braid_get_sessions` to check on the spawned sessions. It can see their status (running, idle, waiting, done) and act accordingly.

5. **You oversee everything in Mission Control.** Press **Cmd+Shift+M** to see all sessions across all worktrees in the kanban board. Sessions that need your attention (questions, approvals) appear in the "Need Attention" column.

## Example: feature + tests in parallel

You tell Claude in worktree `main`:

> "Implement the user profile page and write tests for it. Use separate worktrees for the implementation and tests."

Claude:

1. Creates worktree `feature/profile-page` branched from `main`.
2. Creates worktree `test/profile-page` branched from `main`.
3. Starts a session on `feature/profile-page`: "Implement a user profile page with name, email, and avatar. Follow the existing component patterns."
4. Starts a session on `test/profile-page`: "Write unit and integration tests for the user profile page component."
5. Uses `braid_get_sessions` periodically to check progress.
6. Reports back when both sessions complete.

## Combine with notes

Use notes to pass context between sessions:

- The primary session writes a plan or spec to the notes before spawning subtasks.
- Spawned sessions read the notes to understand the broader context.
- Sessions write their progress to notes so the primary session (or you) can review.

## Combine with linked worktrees

Link related worktrees to a session so Claude has cross-context awareness. For example, link the API worktree to the frontend session so Claude can reference the API types while building the UI.

## Tips for effective multi-agent workflows

- **Keep subtask prompts self-contained.** Each spawned session starts fresh with no conversation history. Include all the context it needs in the prompt.
- **Use independent branches.** Avoid creating subtasks that modify the same files, as this leads to merge conflicts.
- **Monitor Mission Control.** Spawned sessions may hit questions or errors. Check the "Need Attention" column regularly.
- **Start small.** Try delegating one subtask first before orchestrating many in parallel. This helps you calibrate how much context each spawned session needs.

:::note
Spawned sessions consume the same API quota as any other session. Running many sessions in parallel uses more tokens per minute, so be mindful of rate limits.
:::
