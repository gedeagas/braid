---
sidebar_position: 6
title: Editor & Terminal
---

# Editor & Terminal

Open Settings with **Cmd+,** and select the **Editor & Terminal** tab to configure the integrated terminal.

## Options

| Option | Description | Details |
|---|---|---|
| **Terminal font size** | Set the font size for all terminal tabs. | 8 -- 32 px |
| **Terminal shell** | Specify a custom shell path. When blank, Braid uses your system default (`$SHELL`). | Example: `/bin/zsh`, `/opt/homebrew/bin/fish` |
| **Scrollback lines** | Set the number of lines the terminal keeps in its scroll buffer. Higher values use more memory. | 100 -- 100,000 |

## Terminal behavior

Each worktree can have multiple terminal tabs. Terminals persist across panel switches -- if you navigate away from the right panel and come back, your terminal session and output remain intact.

The terminal runs in the worktree's directory by default. If you open a new terminal tab, it starts in the same worktree root.

## Tips

- If you use a non-standard shell like `fish` or `nushell`, enter the full path in the shell field. Braid does not resolve shell names from `PATH` automatically.
- Increase the scrollback if you run commands with long output (e.g., build logs). Decrease it if you notice high memory usage with many open terminals.
- Font size changes apply to all open terminal tabs immediately. You do not need to restart existing terminals.
