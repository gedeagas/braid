# Changelog

All notable changes to Braid are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [26.1.0] - 2026-04-15

First production release.

### Added

- **Auto-update** - built-in update checks with download progress, release notes, and one-click install
- **Diff review** - inline code review with drag selection, multiline comments, range support, and gap expansion
- **Context window tracking** - compaction metrics, boundary display, and activity indicators in chat
- **Quick open** (Cmd+P) - fast file navigation picker
- **Binary file preview** - detection and preview for non-text files
- **VS Code theme import** - import themes directly from VS Code
- **Terminal output reading** via @mentions and MCP tools
- **MCP server elicitation** - OAuth and form input support for MCP servers
- **Customizable activity indicators** - dots and waveform animation styles
- **Commit message draft persistence** across worktree switches
- Copy button and turn footer in chat messages
- Per-worktree state for center view and changes panel
- Icons and item counts on Mission Control sidebar tabs

### Changed

- Refactored Add Project dialog into modular tabs
- Consolidated token display with context info in ActivityIndicator
- Reorganized theme palettes by type and updated defaults
- Replaced Shiki with simpler syntax highlighting
- Mission Control pauses background tasks when panel is hidden

### Fixed

- Release notes rendered as raw HTML instead of formatted content
- SlashAutocomplete scroll behavior for filtered results
- Quick open panel max dimensions
- Multi-worktree merge conflict handling
- Empty tool inputs handling and escape key dismissal
- Chat message code parsing and diff comment rendering
- Timer leak in copy button
- Onboarding auto-completes when a project already exists

---

## [26.0.0] - 2026-03-01 (Shintomicho)

Initial versioned release. Braid is an Electron desktop app for managing Git worktrees and Claude AI sessions with a three-panel layout.

### Core

- **Three-panel layout** - sidebar (projects/worktrees), center (chat + file editor), right (files/diffs/checks/terminal/notes/simulator)
- **Claude Agent SDK integration** - streaming chat sessions powered by `@anthropic-ai/claude-agent-sdk`
- **Multi-session support** - multiple independent Claude sessions per worktree with tab management
- **Session persistence** - full message history saved to `~/Braid/sessions/` and restored on restart
- **Git worktree management** - create, switch, and manage worktrees with origin branch picker
- **Project management** - add projects, detect platforms, copy files between worktrees

### Chat

- Slash command autocomplete with skill and builtin grouping
- @mention file attachment with search and highlighting
- Code snippet attachments (max 5 per message, 100KB limit)
- Image attachments via drag-drop or file picker with lightbox preview
- Message queueing when Claude is running
- AskUserQuestion and ExitPlanMode inline prompts
- Tool permission prompts for controlled tool execution
- Context window usage warnings
- Streaming markdown with block-level memoization
- Session title auto-generation

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
- PR merge bar and push banner
- Jira issue display for current branch

### Mission Control

- Kanban board for cross-worktree session oversight
- Columns: idle, running, need attention, done
- PR tracking: open, draft, merged/closed
- Search and project filtering
- Live session timers

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
- **MCP** - server configuration, health checking, OAuth authentication
- **GitHub** - OAuth device flow authentication
- **Mobile** - React Native / Flutter framework detection, device toolbar

### Infrastructure

- Agent worker isolation via UtilityProcess
- Custom macOS packaging pipeline with notarization
- Electron-vite build system
- Vitest test suite
- Zustand state management with modular store decomposition
- Design token system (`tokens.css`) and reusable component library
- Structured logging with electron-log
- Code splitting and build optimizations

### Branding

- Custom app icons with gradient sweep design
- Notification sounds via Web Audio API
