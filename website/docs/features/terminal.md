---
sidebar_position: 7
title: Terminal
description: Built-in terminal in Braid for running shell commands, build scripts, and interacting with your worktree.
---

# Terminal

Braid includes a fully integrated terminal at the bottom of the right panel. You run shell commands, execute build scripts, and interact with your worktree without switching to an external app.

## Open the terminal

The terminal lives at the bottom of the right panel. Click the collapse toggle (the arrow next to the tab bar) to expand or collapse it. Drag the resize handle at the top edge of the terminal to adjust its height.

When you select a worktree, the terminal automatically opens with its working directory set to that worktree's path.

## Work with multiple tabs

You can have multiple terminal tabs per worktree. Click the **+** button in the terminal tab bar to create a new tab. Each tab runs its own independent shell process.

To switch between tabs, click the tab you want. To close a tab, hover over it and click the close button. You always keep at least one terminal tab open.

:::tip
Double-click a tab label to rename it. This helps you keep track of what each terminal is doing, such as "dev server", "tests", or "logs".
:::

### Drag to reorder

Terminal tabs support drag-and-drop reordering. Grab a tab and drag it to a new position in the tab bar. An accent indicator shows you where the tab will land.

## Setup tab

The first tab in every terminal is the **Setup** tab. This is a special tab tied to your project's lifecycle scripts (configured in project settings).

### How setup works

When you open a worktree for the first time, the Setup tab runs your configured setup scripts automatically in a **shadow terminal** — a background process that captures output without interrupting your workflow. Once setup completes successfully, the result is cached so it doesn't re-run on subsequent visits.

If setup has already run, the Setup tab shows a summary of the previous run. Click **Re-run** to execute the scripts again (for example, after pulling new dependencies).

If you have not configured any setup scripts, the Setup tab shows an empty state with a link to project settings.

:::note
The Setup tab runs scripts in a non-interactive shell. The output is read-only. For interactive work, use a regular terminal tab.
:::

### Cleanup on removal

When you delete a worktree, Braid runs any configured **archive** lifecycle script before removing the directory. This gives you a chance to clean up resources like database state or temporary files.

### Run lifecycle scripts

You can configure setup scripts in your project settings. When you trigger a run (from the sidebar context menu or the Setup tab), Braid spawns a new terminal tab and executes the command. The tab label shows the script name so you can identify it at a glance.

## Terminal settings

Customize the terminal experience in the app settings. You have control over:

- **Font size**: Adjust between 8px and 32px. The change applies to all terminal tabs across all worktrees immediately.
- **Shell path**: Set a custom shell (for example, `/bin/zsh`, `/bin/bash`, or `/usr/local/bin/fish`). Leave it empty to use your system default.
- **Scrollback lines**: Control how many lines of history the terminal retains, from 100 to 100,000 lines.

:::tip
If you use a non-standard shell like Fish or Nushell, set the shell path in settings so every new terminal tab uses it automatically.
:::

## Terminal persistence

Terminal state persists when you navigate away. If you switch to a different worktree and come back, your terminal tabs are still there with their full scrollback history. Processes that were running continue to run in the background.

This persistence is powered by a module-level cache. The app keeps terminal instances alive even when the component unmounts, so you never lose your place.

## Theme integration

The terminal theme updates automatically when you change the app theme. Colors for the prompt, output, errors, and background all match your selected palette. The transition happens instantly with no terminal restart required.

## Resize and collapse

You control the terminal's vertical space with two mechanisms:

- **Drag handle**: Grab the top edge of the terminal area and drag to resize. Make the terminal taller when you need to see more output, or shorter when you want more room for the file tree.
- **Collapse toggle**: Click the arrow icon at the left end of the tab bar to fully collapse or expand the terminal. When collapsed, only the tab bar is visible.

## How it works under the hood

The terminal uses **xterm.js** for rendering and **node-pty** for the shell process. Each tab spawns a real pseudo-terminal (PTY) connected to your configured shell. Input and output stream over Electron's IPC bridge.

The **FitAddon** automatically resizes the terminal grid when the panel dimensions change. A **ResizeObserver** watches the container and adjusts the PTY dimensions so your shell always knows the correct column and row count.

:::note
Terminal processes are tied to the app lifecycle. When you quit Braid, all running terminal processes are terminated.
:::
