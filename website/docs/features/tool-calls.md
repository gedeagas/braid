---
sidebar_position: 3
title: Tool Calls & Output
---

# Tool Calls & Output

When Claude works on your code, it uses **tools** — discrete actions like reading a file, editing a function, running a shell command, or searching your codebase. Braid renders every tool call in the chat so you can see exactly what Claude did and why.

## Understand tool call groups

Tool calls appear as **collapsible groups** in the conversation. Each group bundles the tool calls that happened during a single step of Claude's reasoning. Click a group header to expand or collapse it.

Within a group, you see each individual tool call with:

- **An icon** identifying the tool type (file read, file edit, shell command, search, etc.)
- **The tool name** and its parameters
- **The output** Claude received back
- **The duration** showing how long the call took to complete

This transparency means you never have to guess what Claude changed. Every action is logged and visible.

## Read file badges

When Claude touches files — reading, editing, or creating them — **file badges** appear on the tool call group. Each badge shows the filename and is color-coded:

- Files that were **read** get a neutral badge.
- Files that were **edited** get a badge with **diff stats** showing lines added and removed (e.g., `+12 -3`).
- Files that were **created** show as new additions.

:::tip
Click a file badge to jump directly to that file in the file viewer. This is the fastest way to review Claude's edits without scrolling through the full tool output.
:::

## Expand large outputs

Some tool calls produce verbose output — long file contents, extensive search results, or detailed command output. Braid truncates these by default to keep the chat readable.

When output is truncated, you see a **Show more** button at the bottom of the tool call. Click it to reveal the full output. Click **Show less** to collapse it again.

:::note
Truncation only affects the display. Claude always sees the complete output regardless of what's shown in the UI. Expanding or collapsing output is purely a viewing preference.
:::

## Follow tool activity messages

While Claude is actively working, the **activity indicator** at the bottom of the chat shows a message describing what Claude is currently doing. These messages update in real time as Claude moves between tools.

You can choose between two styles in **Settings**:

| Style | Example messages |
|-------|-----------------|
| **Funny** | "Archaeologically excavating your codebase..." / "Performing mass surgery on your functions..." |
| **Boring** | "Searching files..." / "Editing file..." |

The funny style keeps long-running sessions entertaining. The boring style keeps things professional if you're sharing your screen or prefer straightforward status updates.

## Review diffs inline

When Claude edits a file, the tool call output includes an inline diff showing exactly what changed. Additions appear in green, deletions in red. This gives you immediate visibility into every code change without leaving the chat.

For multi-file edits, each file gets its own diff section within the tool call group. The diff stats on the file badges give you a quick summary, and expanding the tool call shows the full line-by-line changes.

## Common tool types

Here's a reference for the tools you see most often in Braid:

### File operations

- **Read** — Claude reads a file's contents to understand your code. You see the file path and optionally which line range was read.
- **Edit** — Claude makes targeted changes to a file. The output shows the exact string replacement that was applied.
- **Write** — Claude creates a new file or completely replaces an existing one.

### Search operations

- **Grep** — Claude searches file contents using regular expressions. Results show matching lines with context.
- **Glob** — Claude finds files by name pattern. Results list matching file paths.

### Shell operations

- **Bash** — Claude runs a shell command in your worktree. You see the command, its output, and its exit code. This covers everything from running tests to installing packages to checking Git status.

### Navigation

- **LSP** — Claude queries the language server for type information, definitions, or references. This helps Claude understand your codebase's type relationships.

:::note
The set of available tools depends on your Claude SDK configuration and any custom MCP servers you've connected. The tools listed above are the most common defaults.
:::

## Track what changed across a session

To see the cumulative effect of all Claude's edits in a session, switch to the **Changes** tab in the right panel. This shows a Git-style diff of all modified files in the worktree, regardless of which session made the changes.

The Changes tab gives you the big picture. The inline tool call diffs give you the step-by-step details. Use both together to review Claude's work thoroughly before committing.

:::tip
If Claude made a change you don't want, you can tell Claude to revert it in the chat. Claude will use the Edit or Bash tool to undo the specific change. You can also use the integrated terminal to run `git checkout` on individual files.
:::
