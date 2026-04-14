---
sidebar_position: 7
title: Diff Review
---

# Diff Review

Braid includes a GitHub-style diff reviewer that lets you read through file changes and leave inline comments. You use it to review Claude's edits before committing, or to annotate specific lines with feedback that Claude can act on.

## Open a diff review

In the Changes view (right panel), click any modified file. The center panel switches from the chat message list to the diff reviewer, showing the file's changes with syntax highlighting.

The header displays the filename, full path, and diff statistics showing lines added and removed.

## Navigate hunks

Changes are grouped into hunks - contiguous blocks of modified code. Each hunk shows a header with the line range and the function or class context where the change occurs.

Between hunks, unchanged lines are collapsed behind an expander bar that shows how many hidden lines sit between the visible changes. Click the expander to reveal those lines. This keeps the review focused on what actually changed while letting you see surrounding context when you need it.

## Add a line comment

Hover over any line in the diff. A **+** icon appears in the gutter on the left. Click it to open the comment editor below that line. Type your comment and press the save button.

Lines that already have a comment display a blue dot in the gutter instead of the + icon. Click the dot to open the existing comment for editing.

Comments appear inline in the diff as a compact strip showing the comment text. Click the strip to re-open the editor.

## Add a range comment

To comment on multiple consecutive lines, click and drag in the gutter across the lines you want to annotate. As you drag, the selected lines highlight. When you release, the comment editor appears below the last selected line.

Range comments show a line range label (e.g., L12-18) in the comment strip so you can see exactly which lines the feedback covers.

:::tip
Range comments work best when all the selected lines are in the same hunk. If you need to comment on lines that span multiple hunks, use separate comments for each.
:::

## Edit and delete comments

Click any existing comment strip to re-open it in the editor. The editor pre-fills with the existing text so you can modify it. A delete button appears when editing an existing comment - click it to remove the comment entirely.

## Binary files

When you open a binary file (images, compiled assets, etc.) in the diff reviewer, Braid shows a binary diff view instead of text hunks. Image files display inline previews.

## How Claude uses your comments

When you add diff comments and then send a message in the chat, your comments are included as context alongside the message. This lets you point Claude at specific lines and say "fix this" or "explain why you changed this" without needing to quote the code yourself.

:::note
Comments are attached to the current session and persist across app restarts. They are not pushed to GitHub or stored in the repository.
:::
