# Changelog

All notable changes to Braid are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [26.1.8] - 2026-04-20

### Added

- add Chinese (Simplified) language support (#65)
- add git snapshots and chat rollback capability (#64)
- add Big Terminal mode with persistent scrollback (#63)
- add command palette with keyboard shortcut (⌘K) (#62)

### Fixed

- refresh diff view on stage/unstage and clean up worktree state (#61)

### Contributors

Thanks to [@gedeagas](https://github.com/gedeagas) for their contributions to this release!

---

## [26.1.7] - 2026-04-17

### Added

- show per-file diff stats (additions/deletions) in changes panel (#59)
- add Next.js template scaffolding with live validation (#58)
- chat input keyboard shortcuts, EPIPE hardening, Opus noise reduction (#57)
- chat input keyboard shortcuts, EPIPE hardening, snippet history restore (#50)

### Fixed

- remove xhigh level and improve error context (#56)

### Contributors

Thanks to [@gedeagas](https://github.com/gedeagas), [@hanifnr](https://github.com/hanifnr) for their contributions to this release!

---

## [26.1.6] - 2026-04-17

### Added

- trackpad swipe navigation and project avatar toggle (#55)
- add project avatar visibility toggle in settings (#54)
- add extended (1M) context window support (#52)

### Fixed

- snippet card overflow and visual polish (#51)
- fire toast/sound for AskUserQuestion and always bounce dock on waiting_input (#48)

### Contributors

Thanks to [@asaadam](https://github.com/asaadam), [@gedeagas](https://github.com/gedeagas) for their contributions to this release!

---

## [26.1.5] - 2026-04-16

### Fixed

- centralize SimpleGit initialization with enriched environment (#47)
- reattach terminal after container recreation (#46)
- scrollable multiple choice from AI (#43)
- clone to ~/Braid/repos, compact warning UX, mission-control header (#42)
- hide compact warning when /compact is already queued or typed (#38)
- overlap back button (#37)

### Style

- fix header layout for traffic light clearance (#39)

---

## [26.1.4] - 2026-04-15

### Added

- contributors section, project avatars, compact mode, Jira settings (#36)
- add context menu with open in app and reveal in finder (#35)
- dedicated Jira settings page with acli status (#34)
- add chat compact mode for denser CLI-like display (#33)
- add project avatars from GitHub org (#31)
- delete worktree via Delete key when row is focused (#27)
- macOS Liquid Glass icon support (#24)

### Fixed

- suppress spurious error dialog after OTA restart (#29)
- syntax highlighting aliases, enriched subprocess env, and Atlassian docs link (#22)
- redirect Atlassian CLI docs link to official developer docs (#21)

### Other

- add unit tests for buildEnrichedPath and findBinary (#28)

---

## [26.1.3] - 2026-04-15

### Fixed

- source PATH from user's login shell for CLI tool detection (#19)

---

## [26.1.2] - 2026-04-15

### Added

- worktree name display, right-click context menu, and enriched PATH (#18)

### Fixed

- resolve CLI ENOENT errors when app launched from Finder (#17)

---

## [26.1.1] - 2026-04-15

### Added

- add turn stats tooltip and diff preview popover on file badges (#16)
- add client-side image compression for LLM context conservation (#15)
- enhance cards with status details, hover info, and sorting (#14)
- add badge support and simplify AddProjectDialog (#8)

---

## [26.1.0] - 2026-04-15

First production release of Braid - an Electron desktop app for managing Git worktrees and Claude AI sessions.

### Core

- **Three-panel layout** - sidebar (projects/worktrees), center (chat + file editor), right (files/diffs/checks/terminal/notes/simulator)
- **Claude Agent SDK integration** - streaming chat sessions powered by `@anthropic-ai/claude-agent-sdk`
- **Multi-session support** - multiple independent Claude sessions per worktree with tab management
- **Session persistence** - full message history saved to `~/Braid/sessions/` and restored on restart
- **Git worktree management** - create, switch, and manage worktrees with origin branch picker
- **Project management** - add projects, detect platforms, copy files between worktrees
- **Auto-update** - built-in update checks with download progress, release notes, and one-click install

### Chat

- Slash command autocomplete with skill and builtin grouping
- @mention file attachment with search and highlighting
- Code snippet attachments (max 5 per message, 100KB limit)
- Image attachments via drag-drop or file picker with lightbox preview
- Message queueing when Claude is running
- AskUserQuestion and ExitPlanMode inline prompts
- Tool permission prompts for controlled tool execution
- Context window tracking with compaction metrics, boundary display, and activity indicators
- Streaming markdown with block-level memoization
- Session title auto-generation
- Copy button and turn footer in chat messages
- Commit message draft persistence across worktree switches
- Customizable activity indicators - dots and waveform animation styles

### Git & GitHub

- Staging, unstaging, commit with AI-powered message generation
- Pull strategy selection for divergent branches
- Push with automatic upstream tracking
- PR creation, merge (merge/squash/rebase), and status tracking
- CI checks panel with log viewer
- Branch rename with validation and upstream management
- Debounced git fetch to reduce network calls
- Discard staged/unstaged changes

### Right Panel

- **Files** - FileTree and Monaco editor with dirty state tracking
- **Changes** - staged/unstaged file list with diff viewer
- **Checks** - CI status with section-level breakdown
- **Notes** - per-worktree rich text markdown notes with image support
- **Simulator** - iOS Simulator MJPEG streaming with gesture and input controls
- **Window Capture** - screen/window capture source selector
- **Terminal** - multiple terminal tabs per worktree with persistent sessions
- **Diff review** - inline code review with drag selection, multiline comments, range support, and gap expansion
- PR merge bar and push banner
- Jira issue display for current branch

### Mission Control

- Kanban board for cross-worktree session oversight
- Columns: idle, running, need attention, done
- PR tracking: open, draft, merged/closed
- Search and project filtering
- Live session timers
- Icons and item counts on sidebar tabs

### Settings

- General, Appearance, AI, Git, Notifications, Editor & Terminal
- Project-level settings (copy files, git identity, LSP)
- Run scripts management with favorites
- Claude configuration: permissions, hooks, instructions, MCP servers, plugins, skills
- Theme engine with 10 built-in presets and VS Code import
- Internationalization: English, Japanese, Indonesian

### Integrations

- **LSP** - Language Server Protocol support (diagnostics, hover, go-to-definition, rename)
- **Jira** - issue linking via branch name (requires acli)
- **MCP** - server configuration, health checking, OAuth authentication, form input elicitation
- **GitHub** - OAuth device flow authentication
- **Mobile** - React Native / Flutter framework detection, device toolbar

### Other

- Quick open file picker (Cmd+P) for fast file navigation
- Binary file detection and preview for non-text files
- VS Code theme import
- Terminal output reading via @mentions and MCP tools
- Per-worktree state for center view and changes panel
- Custom app icons with gradient sweep design
- Notification sounds via Web Audio API
