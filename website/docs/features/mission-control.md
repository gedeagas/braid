---
sidebar_position: 5
title: Mission Control
---

# Mission Control

When you're running Claude across multiple worktrees simultaneously, keeping track of everything in the sidebar alone gets difficult. Mission Control gives you a bird's-eye view of all your active work in a **kanban board** layout, so you can see at a glance what's running, what needs your attention, and what's done.

## Open Mission Control

Press **Cmd+Shift+M** to toggle Mission Control on and off. It overlays the main Braid interface, giving you a full-screen dashboard. Press the same shortcut again, or click outside the board, to return to your normal workspace.

:::tip
Get in the habit of checking Mission Control periodically when you have multiple sessions running. It surfaces sessions that need your input, so you don't leave Claude waiting on a question you haven't seen.
:::

## Choose your view

Mission Control offers two views, selectable from the toggle at the top of the board:

- **Sessions** — Shows all active Claude sessions across every worktree.
- **PRs** — Shows all pull requests associated with your worktrees.

Switch between views depending on whether you're focused on active development work or on code review and merging.

## Sessions view

The Sessions view organizes your Claude sessions into four columns:

### Idle

Sessions where Claude has finished its current task and is waiting for your next instruction. These are ready for new work whenever you are.

### Running

Sessions where Claude is actively working — reading files, editing code, running commands. You see these sessions processing in real time. Each card shows the current tool activity so you know what Claude is doing without switching to that session.

### Need Attention

Sessions where Claude has asked a question or needs your approval to continue. These are the most important cards to act on, because Claude is blocked until you respond.

:::note
The "Need Attention" column includes both `AskUserQuestion` prompts (where Claude needs clarification) and `ExitPlanMode` prompts (where Claude is waiting for plan approval). Check this column regularly to keep your sessions moving.
:::

### Done

Sessions that have completed their work. These stay in the Done column until you dismiss them.

## Read session cards

Each card in the Sessions view displays:

- **Project name** — Which repository this session belongs to.
- **Branch name** — The worktree's branch, so you know exactly which line of work this is.
- **Status indicator** — The same color-coded dot you see in the sidebar (green, spinning, orange, red).
- **Activity summary** — A brief description of what's happening or what happened.

Click any card to navigate directly to that session in the main workspace. Braid switches to the correct worktree and session automatically.

## PRs view

The PRs view organizes pull requests into three columns:

### Open

Active pull requests that are ready for review or in the process of being reviewed. Each card shows the PR title, number, and which worktree it belongs to.

### Draft

Pull requests that have been created as drafts. These are work-in-progress PRs that aren't ready for review yet.

### Merged / Closed

Pull requests that have been merged or closed. These give you a record of recently completed work.

:::tip
Use the PRs view to quickly spot which branches have open PRs and which ones still need a PR created. If you see a worktree with a "Running" session but no PR, that's likely active development that hasn't been pushed yet.
:::

## Dismiss items

When a session is done and you've reviewed its output, click the **dismiss** action on its card. This removes it from the board, keeping Mission Control clean and focused on active work.

Dismissing a card doesn't delete the session. It simply hides it from Mission Control. You can still access the session through the sidebar and session tabs as usual. Think of dismissal as marking something "acknowledged" rather than "deleted."

## Multi-worktree workflow

Mission Control is designed for the workflow where you run Claude in many worktrees at once. A typical session might look like this:

1. You create three worktrees for three independent tasks.
2. You give Claude instructions in each worktree and start all three sessions.
3. You open Mission Control to monitor progress.
4. You see one session in "Need Attention" — Claude hit an ambiguous requirement.
5. You click the card, answer Claude's question, and return to Mission Control.
6. Two sessions finish. You review their output, dismiss the cards, and create PRs.
7. The third session finishes. You switch to PRs view to check that all three PRs are open and passing checks.

:::note
Mission Control updates in real time. As sessions move between states — from Running to Need Attention, or from Running to Done — the cards move between columns automatically. You don't need to refresh or re-open the view. The board refreshes concurrently with a concurrency limit to avoid overwhelming the system when many worktrees are active.
:::

## Keyboard shortcut reference

| Shortcut | Action |
|----------|--------|
| **Cmd+Shift+M** | Toggle Mission Control |
| Click card | Navigate to session or PR |
| Dismiss button | Remove card from board |

Mission Control pairs naturally with Braid's notification system. When a session finishes or needs attention and the app window is not focused, you receive a **desktop notification**. Click the notification to jump straight to the relevant session, or open Mission Control to see the full picture.
