---
sidebar_position: 11
title: Notes
---

# Notes

Each worktree in Braid has a dedicated notes area where you write markdown to track progress, jot down design decisions, or leave context for yourself. Notes persist across app restarts and sessions.

## Open the Notes tab

Click the **Notes** tab in the right panel. The editor loads any existing notes for the current worktree, or shows an empty editor with a placeholder prompt.

## Write and format notes

The notes editor is a rich-text markdown editor powered by TipTap. You get full markdown support including:

- **Headings** - Use `#`, `##`, `###` for section structure.
- **Lists** - Bullet lists, numbered lists, and nested task lists with checkboxes.
- **Code** - Inline code and fenced code blocks.
- **Bold and italic** - Standard markdown formatting.
- **Task lists** - Check items off as you complete them.

The toolbar above the editor provides quick-access buttons for common formatting operations and image insertion.

## Add images

You can embed images in your notes in three ways:

- **Paste** - Copy an image to your clipboard and paste directly into the editor.
- **Drag and drop** - Drag an image file from Finder into the editor.
- **Insert button** - Click the image button in the toolbar to open a file picker.

Images are automatically resized (max 1200px on the longest side) and converted to WebP for efficient storage. The maximum file size is 5 MB per image.

## Auto-save

Notes save automatically as you type, with a 500ms debounce. A status indicator in the toolbar shows "Saving..." briefly, then "Saved" to confirm. You never need to manually save.

## Clear notes

Click the clear button in the toolbar to erase all notes for the current worktree. A confirmation dialog prevents accidental deletion.

## Claude integration

Claude can read and write your worktree notes using the Braid MCP tools:

- **`braid_read_notes`** - Claude reads the current notes to understand your progress or context.
- **`braid_write_notes`** - Claude writes notes to track what it has done, record decisions, or leave context for future sessions.

This makes notes a shared workspace between you and Claude. You can write a plan in the notes, then tell Claude to follow it. Or ask Claude to document its approach in the notes so you have a record.

:::tip
Notes are especially useful for long-running tasks that span multiple sessions. Write down what has been done and what remains, so when you start a new session, Claude (or you) can pick up where the previous session left off.
:::

:::note
Notes are stored locally in `~/Braid/notes/` as markdown files, one per worktree. They are not committed to git or synced to the cloud.
:::
