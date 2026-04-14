# Changelog

All notable changes to Braid are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - v26.1.0

Large feature release covering diff review, context tracking, streaming improvements, design system expansion, and MCP enhancements.

### Added

- **Diff review system** - inline code review with drag selection, multiline comments, range support, and gap expansion
- **Context window tracking** - compaction metrics, boundary display, and activity indicators in chat
- **Streaming markdown** - block-level memoization for efficient incremental rendering
- **Quick open file picker** (Ctrl/Cmd+P) for fast file navigation
- **Binary file support** - detection and preview for non-text files
- **VS Code theme import** - import themes directly from VS Code
- **Terminal output reading** via @mentions and MCP tools
- **MCP server elicitation** - OAuth and form input support for MCP servers
- **Customizable activity indicators** - dots and waveform animation styles
- **Commit message draft persistence** across worktree switches
- **Streaming animation toggle** in appearance settings
- Copy button and turn footer in chat messages
- Per-worktree state for center view and changes panel
- Diff comment cards for user messages
- Icons and item counts on Mission Control sidebar tabs

### Changed

- Consolidate token display with context info in ActivityIndicator
- Reorganize theme palettes by type and update defaults
- Remove legacy diff review tab functionality
- Remove toast redesign feature flag, apply new design permanently
- Remove Shiki in favor of simpler syntax highlighting, enable VS Code theme import
- Pause Mission Control background tasks when panel is hidden

### Fixed

- SlashAutocomplete scroll behavior for filtered results
- Quick open panel max dimensions for better content display
- Multi-worktree merge conflict handling in GitHub operations
- StreamingMarkdown animation disabled by default (opt-in)
- Empty tool inputs handling and escape key dismissal
- ChatMessage code parsing and diff comment rendering
- Timer leak with ref cleanup in copy button
- Virtualization disabled by default in settings
- Onboarding auto-completes when a project already exists, preventing step 1 reset

### Style

- Increase diff review code block font size from 2xs to base
- Standardize close button styling across toast variants
- Reduce tool call group margins for tighter layout
- Add top padding to changes container
- Add min-width: 0 to prevent text overflow

### Documentation

- Add documentation pages for features, integrations, and settings

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
