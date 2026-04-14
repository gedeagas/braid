---
sidebar_position: 8
title: Run Scripts
---

# Run Scripts

Braid detects and runs project scripts from your package manager or build system. You configure which scripts run during setup, development, and cleanup phases.

## Script detection

When you add a project, Braid scans for scripts from these sources:

| Source | Detected via |
|--------|-------------|
| **npm / yarn / pnpm / bun** | `package.json` scripts section |
| **Makefile** | `Makefile` targets |
| **Cargo** | `Cargo.toml` (build, test, run) |
| **Go** | `go.mod` (build, test, run) |
| **Composer** | `composer.json` scripts |
| **Python** | `pyproject.toml` or `setup.py` |

Detected scripts appear in the Run panel in the right panel.

## Script phases

Braid organizes scripts into three lifecycle phases:

### Setup

Setup scripts run automatically when you open a worktree for the first time. Common setup scripts include `yarn install`, `npm install`, or `bundle install`. They run in a shadow terminal that shows progress without cluttering your main terminal tabs.

Setup results are cached per worktree so they do not re-run on every panel switch.

### Run

Run scripts are development-time commands you trigger manually. These typically include `yarn dev`, `npm start`, or `make watch`. Click a script in the Run panel to start it in a terminal tab.

### Archive

Archive scripts run when a worktree is being cleaned up. Use these for teardown tasks like stopping local servers or cleaning build artifacts.

## Configure scripts

Go to **Settings > Project Settings** and select your project. Under the scripts section, you can:

- Enable or disable auto-detection for each script source.
- Add custom scripts that Braid does not auto-detect.
- Assign scripts to Setup, Run, or Archive phases.
- Set per-project overrides that differ from the defaults.

:::tip
If your project has a non-standard setup process, add a custom setup script that handles everything. This ensures new worktrees are ready to use immediately after creation.
:::
