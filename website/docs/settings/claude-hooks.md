---
sidebar_position: 2
title: Hooks
---

# Claude Hooks

Hooks are shell commands that run automatically in response to events during a Claude session. You use them to automate side effects like linting, notifications, or logging.

## Open hooks settings

Go to **Settings > Claude Config > Hooks**.

## Hook events

Braid supports four hook event types:

| Event | When it fires |
|-------|--------------|
| **Stop** | When Claude finishes a turn (either naturally or when stopped by the user) |
| **Notification** | When a notification would be shown (session done, error, waiting for input) |
| **PreToolUse** | Before Claude executes a tool (Bash, Edit, Write, etc.) |
| **PostToolUse** | After Claude finishes executing a tool |

## Add a hook event

1. Select an event name from the dropdown, or type a custom event name in the text field.
2. Click **+** to add the event.
3. The event appears as an expandable card.

## Add commands to an event

1. Click the event card to expand it.
2. Click **+ Add command**.
3. Enter the shell command to run (e.g., `eslint --fix .` or `say "Claude is done"`).
4. Press **Enter** or click away to save.

You can add multiple commands to a single event. They run in the order listed.

## Edit and remove commands

- Click a command's text field to edit it. Changes save on blur.
- Click the **x** button next to a command to remove it.
- When all commands are removed from an event, the event card is removed automatically.

## Example hooks

| Event | Command | Purpose |
|-------|---------|---------|
| **Stop** | `eslint --fix .` | Auto-lint after Claude edits code |
| **Stop** | `say "Claude finished"` | macOS speech notification |
| **Notification** | `osascript -e 'display notification "Braid" with title "Claude needs you"'` | Custom macOS notification |
| **PreToolUse** | `echo "$(date): tool used" >> ~/braid-audit.log` | Audit log of tool usage |

:::note
Hook commands run in the project's working directory. They do not receive session-specific context like tool names or message content as environment variables.
:::
