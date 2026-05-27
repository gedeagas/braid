# Braid

**Ship more by working in parallel. Multiple AI coding agents. Multiple branches. One app.**

[![macOS](https://img.shields.io/badge/macOS-arm64%20%7C%20x64-000000?logo=apple&logoColor=white)](../../releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

![Braid screenshot](https://getbraid.dev/img/hero-screenshot.png)

The typical AI coding workflow is serial: one task, one conversation, one branch. When an agent is thinking, you wait. When you context-switch, you lose your place.

Braid breaks that pattern. Every session runs in an isolated Git worktree - its own branch, its own filesystem, its own context. Run Claude sessions and terminal-based coding agents in parallel, then check in on any of them without interrupting the others.

> **[Documentation](https://getbraid.dev)** | **[Download](../../releases)**

---

## Install

Download the latest `.dmg` from [Releases](../../releases), open it, and drag **Braid** to Applications.

**Requirements:**

| Dependency | Required | Notes |
| --- | --- | --- |
| [Claude Code](https://claude.ai/code) | Yes | Required for built-in Claude chat sessions |
| [GitHub CLI](https://cli.github.com/) (`gh`) | Yes | Must be authenticated (`gh auth login`) |
| CLI coding agents | No | Optional - installed agents on your `PATH` can be launched in terminal tabs |
| `ANTHROPIC_API_KEY` | No | Optional - only needed if you use your own API key instead of a Claude subscription |
| [Atlassian CLI](https://developer.atlassian.com/) (`acli`) | No | Enables Jira integration |
| Mobile toolchain | No | Enables simulator/emulator streaming and mobile MCP tools |

---

## Features

### Parallel AI Sessions

Run as many Claude sessions as you need - each scoped to its own Git worktree so they never step on each other. Stream output in real time, queue your next message while Claude is still working, and attach images, files, or code snippets for full context. Choose your model, toggle extended thinking, and link related worktrees for cross-context awareness.

### CLI Agent Terminals

Braid auto-detects installed CLI coding agents on your `PATH` and launches them in persistent terminal tabs. Claude Code, Codex, Gemini CLI, GitHub Copilot, Grok, Aider, Goose, Amp, OpenCode, Cursor Agent, and more can run directly inside the workspace. Agent status flows into tabs, badges, notifications, and Mission Control when a terminal needs attention.

### Mission Control

One screen that shows everything: every session, every branch, every PR - organized by status. Idle, running, needs your attention, done. Filter by project, search across sessions. Stop juggling terminal tabs to remember what state each branch is in.

### Inline Code Review

Review AI-generated changes with an interactive diff viewer. Select lines or ranges and leave inline comments that get sent back to the chat as context - the same workflow as a GitHub PR review, but inside Braid.

### Full Dev Environment, Built In

Monaco editor, persistent xterm terminals, and a file tree with inline diffs - all scoped per worktree. Binary file preview for images. LSP support (TypeScript, Go, Rust, Python) gives you hover docs, go-to-definition, and live diagnostics without leaving the app. Monorepo-aware: LSP walks up to the nearest config file so it works correctly inside large repos.

### Git & GitHub Without the Friction

Create worktrees, rename branches, set upstream tracking, and push - all from the sidebar. Generate commit messages from staged diffs. PR status, CI checks, and merge controls (merge / squash / rebase) are surfaced inline. Jira ticket IDs in branch names are automatically resolved and shown alongside checks. Copy files between worktrees during creation.

### MCP & OAuth Support

Claude can authenticate with MCP servers via OAuth device flow. Proactive auth setup available in Settings. Health checks probe server connectivity before sessions start.

### Mobile Development

Stream and control iOS Simulator or Android Emulator screens inside Braid. Link a device to a Claude session so it can inspect screenshots, tap elements, type text, and exercise React Native or Flutter workflows through MCP tools.

### Per-Project Git Identity

Working across a personal project and a work repo? Set a different `user.name` / `user.email` per project so your commits always go out under the right identity.

---

## Building from Source

```bash
git clone https://github.com/gedeagas/braid.git
cd braid
corepack enable
yarn install
yarn dev
```

| Command | Description |
| --- | --- |
| `yarn dev` | Development mode with hot reload |
| `yarn build` | Production build |
| `yarn typecheck` | Type-check main + renderer |
| `yarn test` | Run unit tests (Vitest) |
| `yarn package` | Build `.dmg` installer |

> **Note:** Braid uses **Yarn 4 (Berry)** via Corepack. Do not use npm.

---

## Tech Stack

React 19, TypeScript, Zustand, Claude Agent SDK, MCP SDK, electron-vite, xterm.js, node-pty, Monaco Editor.

---

## Status

Braid is currently in **alpha**. We are not accepting feature requests at this time. Bug reports may be considered - file them via [Issues](../../issues).

## License

[MIT](LICENSE)
