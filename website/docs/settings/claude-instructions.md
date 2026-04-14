---
sidebar_position: 3
title: Instructions
---

# Claude Instructions

Instructions are custom system prompt text that Braid appends to every message sent to Claude. You use them to set coding standards, enforce conventions, or provide project-specific context that Claude should always know.

## Open instructions settings

Go to **Settings > Claude Config > Instructions**.

## Scope

Use the **Global / Project** toggle to switch between scopes:

- **Global** - Instructions that apply to all projects. Stored in `~/.claude/CLAUDE.md`.
- **Project** - Instructions specific to one project. Select the project from the dropdown. Stored in `<project-path>/CLAUDE.md`.

Both global and project instructions are sent to Claude. They combine additively - project instructions do not replace global ones.

## Edit instructions

The instructions editor is a full Monaco code editor with markdown syntax highlighting. Type your instructions directly. Changes are auto-saved with a 300ms debounce - you do not need to click a save button.

## Relationship with CLAUDE.md

The instructions you edit in Settings are the same content as the `CLAUDE.md` files on disk:

- **Global instructions** map to `~/.claude/CLAUDE.md`.
- **Project instructions** map to `<project-root>/CLAUDE.md`.

You can edit either through Settings or by modifying the files directly. Both approaches keep the same content in sync.

## What to include

Good instructions are specific and actionable. Examples:

```markdown
## Coding Standards
- Use TypeScript strict mode
- Prefer functional components with hooks
- Use named exports, not default exports
- Write tests for all new utility functions

## Project Context
- This is a React Native app using Expo
- State management uses Zustand
- API calls go through src/api/ with generated types
- Never modify files in src/generated/
```

:::tip
Keep instructions concise. Claude reads them on every turn, so lengthy instructions consume context window space. Focus on rules that Claude would otherwise violate or context it cannot infer from the code.
:::

:::note
Instructions are not visible to other users. They are stored locally in your Claude configuration and CLAUDE.md files, which you may or may not choose to commit to version control.
:::
