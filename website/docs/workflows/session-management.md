---
sidebar_position: 3
title: Managing Chat Sessions
---

# Managing Chat Sessions

Every worktree in Braid can have multiple independent Claude chat sessions. You run parallel conversations — one for debugging, one for writing tests, one for exploring an API — without any of them interfering with each other.

## Create a New Session

Click the **+** button in the session tab bar at the top of the center panel. A new session opens immediately with a fresh conversation.

Each session is completely independent:

- **Separate conversation history.** Claude in one session has no knowledge of what you discussed in another.
- **Separate context.** File references, tool calls, and code suggestions are scoped to that session.
- **Separate status.** One session can be running while another is idle or waiting for input.

:::tip
Use multiple sessions to separate concerns. Keep a long-running architectural discussion in one session and use a second one for quick, throwaway questions. This prevents your main conversation from getting cluttered with tangents.
:::

## Rename Sessions

**Double-click** a session tab to rename it. An inline text field appears — type your new name and press Enter. Good names make it easy to find the right session at a glance: "Auth refactor" instead of "Session 1."

## Session Status Indicators

Each session tab shows a status badge so you can tell what is happening without switching to it:

| Badge | Meaning |
|-------|---------|
| Spinning indicator | Claude is **running** — processing your message or executing tools. |
| Dot indicator | Claude is **waiting for input** — it asked a question or needs approval. |
| Error indicator | The session hit an **error** — switch to it to see details. |
| No badge | The session is **idle** — ready for your next message. |

## Session Persistence

Every message in every session is automatically saved to `~/Braid/sessions/`. This happens on every update, so you never lose work.

When you restart Braid, all your sessions are restored exactly as you left them:

- Full message history, including Claude's responses and tool call results.
- Session names and tab order.
- Status indicators (though running sessions will show as idle after restart since the Claude process itself does not persist).

:::note
Session files are stored locally on your machine. They are not synced to the cloud or shared with teammates. If you move to a new machine, you need to copy the `~/Braid/sessions/` directory to bring your history along.
:::

## Message Queueing

You do not have to wait for Claude to finish before typing your next message. While Claude is running, type your follow-up in the input field and send it. Braid queues the message and delivers it as soon as the current turn completes.

Your queued message appears below the input area. If you change your mind, **edit or delete** it before Claude finishes — it has not been sent yet.

:::tip
Queued messages are editable. If you notice a typo or want to rephrase your follow-up, click the queued message to modify it. The edited version is what Claude will receive.
:::

## Reorder Session Tabs

Drag session tabs to reorder them. Grab a tab and drop it in the position you want. Your custom order persists across app restarts. File tabs also appear in the same tab bar alongside session tabs, and you can interleave them however you like.

## Mission Control

When you are juggling sessions across multiple worktrees, it helps to see everything in one place. Press **Cmd+Shift+M** to open Mission Control.

Mission Control shows you:

- **All active sessions** across every worktree in every project.
- The **status** of each session (running, idle, waiting, error).
- The **last message** in each session for quick context.

Click any session in Mission Control to jump directly to it — Braid switches to the correct worktree and activates the session tab. This is the fastest way to navigate when you have a dozen sessions spread across five worktrees.

:::note
Mission Control is read-only. You use it for navigation, not for sending messages. Switch to the session itself to continue the conversation.
:::

## Delete a Session

Right-click a session tab and select **Close** to remove it. The session is removed from the tab bar but its data remains in `~/Braid/sessions/` for reference.

## Link worktrees

You can link other worktrees to a session to give Claude cross-context awareness. This is useful when work on one branch depends on code in another branch.

### Add a linked worktree

Click the **Link Worktree** button in the chat header area. A dialog opens showing all available worktrees across your projects. Search and select the worktree you want to link.

Linked worktrees appear as pills above the chat input, showing the branch name of each linked worktree.

### What linking provides

When worktrees are linked, Claude's Braid MCP tools can access data from the linked worktrees. This means Claude can:

- Read git status from the linked branch.
- Check PR status and CI checks on the linked branch.
- Read notes from the linked worktree.

### Use cases

- **Monorepo development** - Link the API worktree to the frontend session so Claude can reference API types while building UI components.
- **Coordinated refactoring** - Link the original branch to a migration branch so Claude can see both the old and new patterns.
- **Cross-branch awareness** - Link a feature branch to a release branch so Claude knows what has already been merged.

### Remove a link

Click the **x** on a linked worktree pill to remove the link. This does not affect the linked worktree itself, only the connection to this session.

## Best Practices

- **One concern per session.** Mixing unrelated topics makes conversations harder to follow.
- **Name your sessions immediately.** A descriptive name saves you from clicking through tabs later.
- **Use queueing aggressively.** If you know what you want next, queue it and save the round-trip wait.
- **Check Mission Control periodically.** It is easy to forget about a session waiting for input in another worktree.
- **Link related worktrees.** When work spans multiple branches, linking gives Claude the context it needs without you having to copy-paste between sessions.
