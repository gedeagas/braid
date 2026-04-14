---
sidebar_position: 5
title: Braid MCP Server
---

# Braid MCP Server

Every Claude session in Braid automatically has access to a built-in MCP (Model Context Protocol) server that exposes Braid-specific functionality. This lets Claude interact with git, notes, terminals, and other sessions without relying on shell commands.

## Available tools

### Git and CI

| Tool | Description |
|------|-------------|
| `braid_get_git_status` | Get structured working tree status (staged/unstaged changes with status codes M, A, D, R, ?) |
| `braid_get_pr_status` | Get PR number, title, state, URL, mergeable status, review decision, and draft status |
| `braid_get_checks` | Get CI/CD check results (name, status, conclusion, URL, workflow) |

### Notes

| Tool | Description |
|------|-------------|
| `braid_read_notes` | Read the persistent markdown notes for the current worktree |
| `braid_write_notes` | Write markdown notes (overwrites existing). Use for tracking progress and decisions |

### Cross-worktree

| Tool | Description |
|------|-------------|
| `braid_get_sessions` | List all sessions across all worktrees (id, name, status, model, run duration) |
| `braid_create_worktree` | Create a new git worktree managed by Braid (appears in the sidebar) |
| `braid_create_session` | Start a new Claude session on any worktree with a given prompt |
| `braid_read_terminal` | Read recent terminal output (last ~200 lines per tab) from the current worktree |

## Automatic registration

You do not need to configure anything. The Braid MCP server is registered automatically when a session starts. Claude sees these tools alongside any other MCP servers you have configured.

## Cross-worktree awareness

The `braid_get_sessions` tool gives Claude visibility into what is happening across your entire workspace. Claude can see:

- Which worktrees have active sessions.
- The status of each session (running, idle, waiting for input).
- Session names and models.
- How long each session has been running.

This is useful when Claude needs to coordinate work across branches or check whether a related task has completed.

## Spawning sessions

Claude can use `braid_create_worktree` and `braid_create_session` to delegate work:

1. Claude creates a new worktree branched from the current branch.
2. Claude starts a new session on that worktree with specific instructions.
3. Claude checks progress with `braid_get_sessions`.
4. You see the new worktree and session appear in the Braid sidebar and Mission Control.

:::tip
Multi-agent orchestration works best when each delegated task is independent. Give the spawned session a clear, self-contained prompt so it can work without needing to ask questions.
:::

## Reading terminal output

The `braid_read_terminal` tool lets Claude check build output, test results, and server logs without asking you to copy-paste. It returns the last ~200 lines from each terminal tab (configurable up to 1000 lines).

ANSI escape codes are automatically stripped from the output for clean, readable text.

:::note
The Braid MCP server runs in-process - there is no child process or network overhead. Tool calls resolve instantly against local data.
:::
