---
sidebar_position: 2
title: Chat with Claude
description: Use Claude AI to read code, edit files, and run commands directly in your Git worktree through Braid's chat interface.
---

# Chat with Claude

Every worktree in Braid gives you a direct line to Claude. You type instructions in natural language, and Claude reads your code, edits files, runs commands, and builds features — all within the context of your working directory.

## Start a session

Click a worktree in the sidebar, then type your message in the chat input at the bottom of the center panel. Press **Enter** to send. Claude begins working immediately, reading files and making changes in your worktree.

You can run **multiple independent sessions** per worktree. Click the **+** button in the session tab bar to create a new chat. Each session maintains its own conversation history, so you can have one session focused on a feature and another debugging an unrelated issue, both in the same branch.

## Manage session tabs

Session tabs appear at the top of the center panel. You can:

- **Drag to reorder** — Arrange your sessions in whatever order makes sense.
- **Double-click to rename** — Give sessions descriptive names like "Auth refactor" or "Fix CI".
- **Check status badges** — Each tab shows a badge indicating whether the session is running, waiting for your input, or has encountered an error.

:::note
Session history persists across app restarts. When you relaunch Braid, all your sessions restore with their full message history intact.
:::

## Choose a model

Click the model selector dropdown in the chat input area to pick which Claude model powers your session:

| Model | Best for |
|-------|----------|
| **Sonnet 4.6** | General development tasks. Fast and capable. This is the default. |
| **Opus 4.6** | Complex architectural decisions, nuanced refactoring, and difficult debugging. |
| **Haiku 4.5** | Quick questions, simple edits, and lightweight tasks where speed matters most. |

Toggle the **Thinking** checkbox next to the model selector to enable extended thinking. When active, Claude spends more time reasoning through complex problems before responding, which can improve accuracy on multi-step tasks.

:::tip
Start with Sonnet for most work. Switch to Opus when you need Claude to reason through a particularly tricky problem, and use Haiku for rapid-fire questions that don't require deep analysis.
:::

## Use slash commands

Type `/` in the chat input to open the autocomplete dropdown. Slash commands give you shortcuts to common actions without typing out full instructions.

Commands come from two sources:

- **Built-in** — Core commands provided by the Claude SDK.
- **Skills** — Custom commands from your user-defined skills.

Navigate the dropdown with arrow keys, press **Enter** to select, or **Escape** to dismiss. Each command shows a brief description so you know what it does before selecting it.

## Attach files, snippets, and images

You have several ways to give Claude additional context beyond your typed message.

### @mention files

Type `@` followed by a filename to trigger the **mention autocomplete** dropdown. The dropdown searches all tracked files in your worktree and shows results with matched characters highlighted. While results load, skeleton placeholders keep the UI responsive.

Navigate the dropdown with arrow keys, press **Enter** to select, or **Escape** to dismiss. The selected file's content is included alongside your message, giving Claude focused context without needing to read the entire codebase.

A highlight backdrop renders behind `@file` tokens in the textarea so you can easily see which files you've mentioned.

### Attach code snippets

You can attach code snippets to your message for targeted context. Snippets appear as expandable chips below the input area, each showing the line count as a badge.

- **Maximum 5 snippets** per message
- **100 KB limit** per snippet
- Click a chip to expand and preview its content
- Click the close button on a chip to remove it

:::tip
Snippets are useful when you want Claude to focus on a specific section of code rather than an entire file. Copy the relevant lines and attach them as a snippet for the most precise context.
:::

### Drag and drop images

Drag image files directly into the chat input area, or use the file picker. Braid supports **PNG**, **JPEG**, **GIF**, and **WebP** formats. You can attach up to **5 images** per message, with each image capped at **2 MB**.

:::note
Images are converted to base64 data URIs and sent as multimodal content blocks. This means Claude can see screenshots, mockups, error messages, and design references you share.
:::

Use image attachments when you want to show Claude a UI bug, share a design you want implemented, or provide visual context that would be hard to describe in text.

## Queue your next message

You don't have to wait for Claude to finish before typing your next instruction. While a session is running, type your follow-up message in the input area. The message appears as **queued** and sends automatically once Claude completes the current turn.

You can edit a queued message at any time before it sends. If you change your mind entirely, delete the queued text and it won't be sent.

:::tip
Message queueing is especially useful when you realize you forgot to mention something. Type the additional context while Claude is still working, and it gets included in the next turn automatically.
:::

## Read the activity indicator

While Claude is working, the activity indicator appears above the chat input showing three pieces of information:

- **Elapsed time** — How long the current turn has been running.
- **Token count** — How many tokens Claude has consumed in this turn.
- **Current tool** — What Claude is doing right now, like reading a file, running a command, or editing code.

The tool activity messages come in two styles. In **Settings**, you can choose between **funny** messages (like "Speed-reading through your spaghetti code...") or **boring** messages (like "Reading file..."). Pick whichever style keeps you sane during long-running tasks.

## Understand context compaction

Claude operates within a 200,000-token context window. As a conversation grows long, it approaches this limit. When it does, Braid automatically triggers **context compaction** - Claude summarizes the earlier part of the conversation to free up space, then continues working with the compressed history.

When compaction occurs:

- A visual boundary marker appears in the chat showing "Context compacted" with before and after token counts (e.g., "180k -> 45k").
- The activity indicator briefly shows a compacting status.
- Messages above the boundary are summarized, not deleted. Claude retains the essential context.

You do not need to do anything when compaction happens. It is automatic and designed to let long sessions continue without hitting the context limit.

:::note
If you notice Claude losing track of earlier context after compaction, re-state the key details in your next message. Compaction preserves the important information, but very specific details from early in a long conversation may be condensed.
:::

## Handle Claude's questions

Sometimes Claude needs clarification before proceeding. When this happens, the session status changes to **waiting** and a prompt appears inline in the chat. Type your answer and press Enter to let Claude continue.

The question prompt may include predefined options you can click, or it may accept freeform text. Either way, Claude resumes immediately after you respond.
