---
sidebar_position: 1
title: Permissions
---

# Claude Permissions

Permissions control which tools Claude can use without asking for your approval. You define allow and deny rules at both the global level (all projects) and per-project level.

## Open permissions settings

Go to **Settings > Claude Config > Permissions**.

## Scope

Use the **Global / Project** toggle at the top to switch between scopes:

- **Global** - Rules that apply to all projects. Stored in your Claude config.
- **Project** - Rules that apply to a specific project only. Select the project from the dropdown.

Project-level rules are evaluated alongside global rules. A project deny rule overrides a global allow rule for the same tool.

## Bypass permissions

The **Bypass Permissions** toggle at the top disables all permission prompts. When enabled, Claude can use any tool without asking. Use this for trusted projects where you want maximum speed.

:::note
Bypassing permissions means Claude can run any shell command, edit any file, and use any tool without confirmation. Only enable this for projects where you trust the code and Claude's instructions.
:::

## Allow and deny lists

Rules appear as tags in two sections:

- **Allowed** - Tools Claude can use without asking.
- **Denied** - Tools Claude is blocked from using entirely.

## Rule syntax

Each rule has two parts: a **tool name** and an optional **detail pattern**.

| Rule | Meaning |
|------|---------|
| `Bash` | Allow (or deny) all Bash commands |
| `Bash(git merge:*)` | Allow (or deny) Bash commands matching `git merge:*` |
| `Edit` | Allow (or deny) all file edits |
| `Write` | Allow (or deny) all file writes |
| `Read` | Allow (or deny) all file reads |

The detail pattern supports glob syntax with `*` as a wildcard.

## Add a rule

1. Choose **Allow** or **Deny** from the segmented control.
2. Enter the tool name (e.g., `Bash`).
3. Optionally enter a detail pattern (e.g., `git push:*`).
4. Click **+** or press **Enter**.

## Remove a rule

Click the **x** button on any rule tag to remove it. The change is saved immediately.

## Common patterns

| Goal | Rule | List |
|------|------|------|
| Let Claude run git commands freely | `Bash(git:*)` | Allow |
| Block destructive git operations | `Bash(git push --force:*)` | Deny |
| Let Claude edit any file | `Edit` | Allow |
| Block writing to config files | `Write(*.config.*)` | Deny |
