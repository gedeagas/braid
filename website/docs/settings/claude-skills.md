---
sidebar_position: 4
title: Skills
---

# Claude Skills

Skills are custom slash commands you define for Claude. When you type `/your-skill` in the chat input, Braid expands it into a full prompt that instructs Claude to perform a specific task.

## Open skills settings

Go to **Settings > Claude Config > Skills**.

## Create a skill

1. Click **Create Skill**.
2. Enter a **name** (this becomes the slash command, e.g., `commit-msg` becomes `/commit-msg`).
3. Enter a **description** shown in the autocomplete dropdown.
4. Write the **prompt** - the full text that replaces the slash command when invoked.
5. Choose the **scope**: global (all projects) or project-specific.
6. Save.

## Skill scope

| Scope | Visibility | Stored in |
|-------|-----------|-----------|
| **Global** | Available in all projects | Claude global config |
| **Project** | Available only in the selected project | Claude project config |

## Invoke a skill

Type `/` in the chat input to open the autocomplete dropdown. Skills appear alongside built-in commands, grouped by source. Select a skill and press Enter. The skill's prompt replaces the slash command text and is sent to Claude.

## Edit a skill

Click a skill in the list to open its editor. Modify the name, description, or prompt and save.

## Delete a skill

Click the delete button on a skill card. A confirmation dialog prevents accidental deletion.

## Example skills

| Name | Description | Prompt |
|------|-------------|--------|
| `review-pr` | Review the current PR | "Review all changes in this branch compared to main. Check for bugs, security issues, and code style violations. Summarize your findings." |
| `commit-msg` | Generate a commit message | "Look at the staged changes and recent commit history. Generate a concise commit message following the project's conventions." |
| `add-tests` | Write tests for recent changes | "Identify the files changed in the last commit. Write unit tests for any new functions or modified behavior." |

:::tip
Skills are especially useful for repetitive tasks with complex prompts. Instead of typing "review all changes compared to main and check for..." every time, create a `/review-pr` skill and invoke it with two keystrokes.
:::
