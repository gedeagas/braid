---
sidebar_position: 1
title: Installation
description: Install Braid on macOS and set up Git worktree management with AI coding agent sessions.
---

# Installation

Install Braid on your Mac and get ready to manage worktrees and Claude AI sessions from one place.

## Before you begin

Make sure your system meets these requirements:

- **macOS** on Apple Silicon (M1 or later) or Intel
- **GitHub CLI** (`gh`) installed and authenticated
- **Claude CLI** authenticated (`claude` command available)

:::tip
Install the GitHub CLI with Homebrew: `brew install gh`. Then run `gh auth login` to authenticate.
:::

## Install Braid

1. Download the latest `.dmg` file from the [Releases](https://github.com/gedeagas/braid/releases) page.
2. Open the DMG and drag **Braid** into your **Applications** folder.
3. Launch Braid from Applications.

On first launch, macOS may show a security prompt. Click **Open** to continue.

## First launch setup

When you open Braid for the first time, it creates a `~/Braid/` directory. This directory stores your worktrees and session data. You do not need to create it yourself.

The directory structure looks like this:

```
~/Braid/
  worktrees/    # Git worktrees managed by the app
  sessions/     # Chat session history and data
```

## Authentication

Braid uses your Claude CLI authentication by default. If you have `claude` installed and logged in, sessions work automatically.

Optionally, you can provide a custom Anthropic API key in **Settings > AI**. This overrides CLI auth.

:::note
If you provide a custom API key, it is stored locally on your machine and only sent to Anthropic's API.
:::

## Verify the installation

After setup, you should see the three-panel layout:

- **Left sidebar** for projects and worktrees
- **Center panel** for chat sessions and file editing
- **Right panel** for file trees, git changes, and terminals

If the app launches and shows this layout, you are ready to add your first project.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "App is damaged" warning | Run `xattr -cr /Applications/Braid.app` in Terminal |
| GitHub features not working | Run `gh auth status` to confirm authentication |
| Claude not responding | Run `claude` in Terminal to verify CLI auth, or check your API key in **Settings > AI** |

:::info
Braid stores all data locally in `~/Braid/`. To reset the app, quit Braid and delete this directory. Your git repositories remain untouched.
:::
