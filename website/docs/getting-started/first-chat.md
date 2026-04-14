---
sidebar_position: 3
title: Send Your First Message
description: Start a conversation with Claude to explore your codebase, edit files, and run commands inside Braid.
---

# Send Your First Message

Start a conversation with Claude to explore your codebase, make edits, or run commands -- all within Braid.

## Start a chat session

1. Select a worktree in the left sidebar.
2. A new chat session opens automatically in the center panel.
3. Type your message in the input field at the bottom.
4. Press **Enter** to send.

Claude streams its response in real-time. You see each word appear as it generates.

## Watch Claude work

As Claude responds, it may call tools to accomplish your task. These tool calls appear inline in the conversation:

- **File reads** -- Claude opens files to understand your code
- **File edits** -- Claude proposes changes with highlighted diffs
- **Bash commands** -- Claude runs terminal commands in your worktree

Each tool call renders with an icon and collapsible details. Click a tool call group to expand or collapse it.

:::tip
You can open any file Claude references by clicking its name in a tool call. It opens in the center panel's file editor.
:::

## Monitor progress

The **activity indicator** at the top of the chat shows:

- Elapsed time since the message was sent
- Token usage for the current turn
- A description of what Claude is currently doing

If a response takes too long or goes in the wrong direction, click the **stop button** to halt generation.

## Choose your model

Click the **model dropdown** at the top of the chat input to select a model:

| Model | Best for |
|-------|----------|
| **Sonnet** | Fast, everyday coding tasks |
| **Opus** | Complex reasoning and multi-step work |
| **Haiku** | Quick answers and lightweight tasks |

Toggle **Thinking** next to the model selector to enable extended reasoning. This gives Claude more space to plan before responding, which helps with complex problems.

:::info
Model selection applies per session. You can use different models for different chat sessions in the same worktree.
:::

## Queue your next message

You do not need to wait for Claude to finish before composing your next message. Type ahead and your message is queued. It sends automatically when Claude completes its current turn.

You can edit a queued message before it sends.

## Respond to Claude's questions

Sometimes Claude asks for clarification before proceeding. When this happens, a prompt appears inline in the chat. Type your answer and press **Enter** to continue.

Claude may also ask you to approve a plan before executing it. Review the proposed steps and click **Approve** or provide feedback.

## Attach context

Give Claude targeted context to work with:

- **@mention files** — Type `@` to search your worktree files. Select a file to include its content with your message.
- **Code snippets** — Attach up to 5 code snippets (100 KB each) that appear as expandable chips below the input.
- **Images** — Drag and drop screenshots, mockups, or error captures (PNG, JPEG, GIF, WebP — up to 5 per message, 2 MB each).

## Use slash commands

Type `/` in the input field to see available commands. Use arrow keys to navigate the dropdown and **Enter** to select. Slash commands give you quick access to built-in actions and custom skills.

:::note
You can have multiple chat sessions per worktree. Click the **+** button in the tab bar to create a new session. Each session maintains its own independent conversation history.
:::

## Next steps

Now that you can chat with Claude, explore these features:

- Create additional [worktrees](/docs/getting-started/first-project) to work on multiple branches
- Use the **Changes** tab in the right panel to review git diffs
- Open the integrated **Terminal** to run commands alongside your chat
