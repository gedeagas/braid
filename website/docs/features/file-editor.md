---
sidebar_position: 6
title: File Editor
---

# File Editor

Braid includes a built-in code editor powered by Monaco (the same engine behind VS Code). You open files directly from the right panel and edit them alongside your chat sessions without leaving the app.

## Open a file

Navigate to the **Files** tab in the right panel. The file tree shows every file in your worktree. Click any file to open it as a tab in the center panel.

The file appears next to your chat session tabs in the tab bar. You can have multiple files open at once and switch between them freely.

:::tip
You can also open files that Claude references during a conversation. When a tool call shows a file path, clicking it opens the file in the editor.
:::

## Edit and save

Start typing to make changes. The editor gives you the same editing experience you expect from a modern code editor:

- **Syntax highlighting** for TypeScript, JavaScript, Python, Rust, Go, CSS, HTML, YAML, SQL, GraphQL, Protobuf, Dockerfiles, and more
- **Line numbers** along the left gutter
- **Word wrap** enabled by default
- **Whitespace rendering** on selection so you can spot indentation issues
- **Tab size** set to 2 spaces

Press **Cmd+S** (or Ctrl+S on non-Mac keyboards) to save your changes. The Save button in the toolbar also works if you prefer clicking. While the file is saving, the button text updates to reflect the progress.

:::note
The editor detects the language automatically from the file extension. Files it does not recognize open as plain text.
:::

## Track unsaved changes

When you modify a file, a dot indicator appears on the tab. This is the dirty state marker. It tells you at a glance which files have unsaved edits.

The dot disappears once you save. If you switch to another tab and come back, your unsaved edits are still there. The editor preserves your work until you explicitly save or close the tab.

If a save fails (for example, due to a permissions issue), an error message appears in the toolbar. You can retry immediately.

## Organize file tabs

File tabs live in the same tab bar as your chat sessions. You can **drag them to reorder**, placing related files next to each other or grouping them near the session they belong to. You can freely interleave file tabs and session tabs in whatever arrangement makes sense for your workflow.

The center panel switches between session view and file view based on which tab is active. Click a session tab to return to the chat, or click a file tab to jump back to the editor. The transition is instant.

To close a file tab, click the close button on the tab. If the file has unsaved changes, the dirty dot reminds you to save first.

You can have any number of file tabs open. Each tab loads independently, so opening many files does not slow down the editor.

## Theme integration

The editor theme matches your app theme. When you switch between light and dark mode, the editor updates automatically. Syntax colors, the background, the gutter, and the cursor all adapt to your chosen palette.

This means you never deal with a jarring contrast between the editor and the rest of the app. The theme applies instantly with no reload required.

## Supported languages

The editor maps file extensions to languages automatically. Here are some of the supported formats:

| Extension | Language |
|-----------|----------|
| `.ts`, `.tsx` | TypeScript |
| `.js`, `.jsx` | JavaScript |
| `.py` | Python |
| `.rs` | Rust |
| `.go` | Go |
| `.css`, `.scss` | CSS / SCSS |
| `.html` | HTML |
| `.json` | JSON |
| `.md` | Markdown |
| `.yml`, `.yaml` | YAML |
| `.sql` | SQL |
| `.graphql` | GraphQL |
| `.proto` | Protobuf |
| `Dockerfile` | Dockerfile |

Files with unrecognized extensions open as plain text with no highlighting.

## Keyboard shortcuts

| Action | Shortcut |
|--------|----------|
| Save file | Cmd+S |

The editor also supports standard Monaco keyboard shortcuts for navigation, selection, multi-cursor editing, and search within the file.

:::tip
Use the file editor alongside Claude to review changes in real time. As Claude modifies files during an agentic session, you can open those files to inspect the results immediately.
:::
