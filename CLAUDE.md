# Braid

Electron desktop app (React 19 + TypeScript + Zustand) for managing Git worktrees and multi-agent AI sessions (Claude, Codex, Cursor, Copilot, Gemini, Grok, Hermes, Droid). Three-panel layout: sidebar (projects/worktrees), center (chat + file editor + embedded terminals), right (files/diffs/checks/terminal/notes/simulator/search). Includes a Mission Control kanban board for cross-worktree oversight and a mobile companion server for physical device pairing.

## Architecture

- **Main process** (`src/main/`): Electron window, IPC handlers, services
- **Preload** (`src/preload/index.ts`): Context-isolated bridge exposing `api.{storage,git,agent,pty,simulator,scripts,templates,windowCapture,github,jira,sessions,shell,files,search,clipboard,claudeCli,dialog,window,claudeConfig,menu,dock,notes,lsp,updater,drag,settings,mobile}`
- **Renderer** (`src/renderer/`): React UI with Zustand stores
- **Shared** (`src/shared/`): Types/protocols shared between main and renderer (search, templates, mobile-protocol, projectName)
- **IPC flow**: changes must be threaded through all 3 layers (`src/main/ipc.ts` -> `src/preload/index.ts` -> `src/renderer/lib/ipc.ts`)

## Key Directories

```
src/main/services/
  git/              # Modular: core, branches, config, status, operations, worktrees, snapshots, types
  agentWorker/      # Worker thread management: core, errorClassifier, mcp, tools
  agentHooks/       # Multi-agent hook system: per-agent adapters (claude, codex, cursor, copilot, gemini, grok, hermes, droid, antigravity), hookScript, jsonHooksConfig
  lsp/              # LSP server lifecycle: detect, download, helpers, operations, pool, types
  mobileServer/     # Mobile companion: e2ee pairing, discovery, rpc, protocol, deviceStore
  ptyDaemon/        # Persistent terminal daemon: checkpoint, sessionHost, socketServer, lifecycle
  agent.ts          # Main agent orchestration
  agentGenerate.ts  # Content generation helpers
  agentHookServer.ts # Hook server for agent terminal sessions
  agentPermissions.ts # Tool permission allow/deny lists
  agentProcess.ts   # Agent process management
  agentProcessTypes.ts # Agent process type definitions
  agentTypes.ts     # Agent type definitions
  agentUtils.ts     # Agent utility functions
  autoUpdate.ts     # Electron auto-updater integration
  braidMcp.ts       # In-process MCP server for Claude SDK
  claudeConfig.ts   # Claude config (permissions, hooks, skills, MCP)
  claudeConfigMcp.ts # MCP server configuration management
  claudePath.ts     # Claude CLI path detection
  files.ts          # File operations + platform/framework detection
  github.ts         # GitHub API (gh CLI wrapper)
  githubAuth.ts     # GitHub device flow OAuth
  hookInstaller.ts  # Agent hook installation into worktrees
  jira.ts           # Jira integration (acli wrapper)
  lsp-servers.ts    # LSP server definitions/registry
  mcpAuth.ts        # MCP server OAuth authentication
  mcpHealth.ts      # MCP server health checks
  mobileDevice.ts   # Mobile device management
  mobileMcp.ts      # MCP bridge for mobile devices
  notes.ts          # Per-worktree notes persistence
  pty.ts            # Pseudo-terminal (node-pty)
  ptyDaemon/        # Persistent PTY daemon with reattach support
  rgPath.ts         # ripgrep binary path resolution
  scriptDetector.ts # Project script detection (package.json, Makefile, etc.)
  search.ts         # ripgrep-powered file content search + replace
  sessionStorage.ts # Session persistence to ~/Braid/sessions/
  simulator.ts      # iOS/Android simulator control
  storage.ts        # Main-process settings/project persistence
  templates.ts      # Project scaffold templates
  windowCapture.ts  # Screen/window capture for visual context

src/main/lib/       # Utilities: logger, serviceCache, binaryFile, enrichedEnv, errors

src/shared/         # Types shared between main/renderer: search, templates, mobile-protocol, projectName

src/renderer/store/
  sessions/         # Decomposed Zustand store with handlers/ directory
  ui/               # UI preferences: layout, theme, terminal, terminals, settings, apps, helpers slices
  missionControl.ts # Kanban board state
  prCache.ts        # PR status caching (60s refresh)
  projects.ts       # Projects + worktrees store
  rateLimits.ts     # API rate limit tracking
  updater.ts        # Auto-update state
  flash.ts          # Ephemeral toast notifications
  toasts.ts         # Rich toast notifications

src/renderer/components/
  Center/           # ChatView, ChatMessage, ChatHeader, ChatInput, ChatMessageList, ToolCallGroup/, SessionTabBar, BranchBar, StreamingMarkdown, DiffReviewView, CodeReviewView, BigTerminalView, ModelSelector, SlashAutocomplete, MentionAutocomplete, RateLimitBars, WebAppOverlay, ImageLightbox, ElicitationPrompt, ToolPermissionPrompt, ActivityIndicator, TurnFooter, QueuedMessageBanner
  Right/            # RightPanel, FileTree, FileViewer, ChangesView, ChecksView, TabbedTerminal, NotesView, SimulatorView, DiagnosticsPanel, PrMergeBar, JiraSection, SearchView/, RunPanel, SetupPanel, DeviceToolbar, FrameworkToolbar, ReviewsSection, PushBanner, PullStrategyDialog, WindowCaptureView, LspInstallNudge, LspStatusBadge, NekoWalk
  Sidebar/          # SidebarView, ProjectList, WorktreeRow, AddProjectDialog/ (tabbed: Local, GitHub, QuickStart), AddWorktreeDialog, ActivityBar, ActivityBarApps, ProjectGroupRow, CopyFilesSection, JiraLookupField
  MissionControl/   # KanbanColumn, SessionCard, PrCard, McFilterBar, OverviewBanner, SessionHoverCard, TerminalCard
  CommandPalette/   # Cmd+K command palette
  QuickOpen/        # Quick file open dialog
  Shortcuts/        # Keyboard shortcuts modal + ShortcutBadge
  Onboarding/       # OnboardingOverlay, FeatureTour, SimulatorTour
  Settings/         # SettingsOverlay, SettingsNav, + pages: General, Appearance, AI, Editor, Git, GitHub, Jira, Mobile, Notifications, Analytics, Experimental, About, Project, ProjectCopyFiles, ProjectGitIdentity, ProjectLsp, RunScripts, Apps, ClaudeHooks, ClaudeInstructions, ClaudeMcp/, ClaudePermissions, ClaudePlugins, ClaudeSkills
  shared/           # Toggle, SegmentedControl, ContextMenu, Tooltip, ResizeHandle, Checkbox, ErrorBoundary, GhAuthDialog, UpdateDialog, Toast, ToastContainer, FlashToastContainer, AppFavicon, BinaryDiffView, BottomTerminalStrip, OpenInDropdown, ProjectPillDropdown, TerminalSearch, icons/
  ui/               # Button, Dialog, Spinner, Badge, Card, Combobox, AsyncCombobox, EmptyState, FormField, SectionHeader, SkeletonRows, StatusDot, BouncingDots, WaveformBars, CoachMark, SpotlightTour

src/renderer/hooks/    # useTabReorder, useChatScroll, useGesture, useLspProviders, useAutoUpdate, useShikiHighlight, useSwipeNavigation, useMjpegStream, useProjectNotifyStatus, useTerminalClipboardPaste, useTerminalFileDrop, useCopyToClipboard, useDragScroll, useAsyncHighlight
src/renderer/lib/      # ipc, i18n, shortcuts, sounds, constants, layoutConstants, storageKeys, branchValidation, kanbanColumns, randomBranch, agentCatalog, agentDetection, agentStatus, agentStatusOsc, agentTitleDetection, agentCompletionCoordinator, codexTerminalDetection, embeddedApps, appActions, appBrand, imageCompression, parseMarkdownBlocks, shikiHighlighter, rehypeAnimate, diffUtils, fileDragMime, lspUtils, mergeConflictPrompt, prPrompt, sessionTitle, tabNavigation, terminalNotifications, rateLimitCache, online, openExternalLink, shellEscapePath, pendingReveal, replayGuard, remend, incompleteCodeUtils, BlockIncompleteContext, chatScrollContext, simulatorRpc, logger
src/renderer/types/    # session.ts, git.ts, ui.ts, claude-config.ts, lsp.ts, review.ts (re-exported via index.ts)
src/renderer/themes/   # Theme engine: apply.ts, palettes/, deriveTerminal.ts, terminal.ts, monaco.ts, vscode.ts
src/renderer/locales/  # en/, ja/, id/, zh/ - namespaces: common, center, sidebar, right, missionControl, settings, shortcuts
src/renderer/styles/   # ~68 modular CSS stylesheets imported via styles/index.css
```

## Package Manager

**Yarn 4 (Berry)** via Corepack. Do NOT use npm.
- `.yarnrc.yml` sets `nodeLinker: node-modules` (required for Electron native modules)

## Commands

```bash
yarn dev          # Start dev mode (electron-vite)
yarn build        # Production build
yarn typecheck    # Type-check both main + renderer
yarn test         # Run Vitest unit tests
yarn package      # Build macOS .app
```

## Type-checking

Two tsconfigs: `tsconfig.node.json` (main process) and `tsconfig.web.json` (renderer). Path alias `@` -> `src/renderer`.

## Agent Integration

- **Claude SDK**: Uses `@anthropic-ai/claude-agent-sdk` in main process (`src/main/services/agent.ts`)
- **Multi-agent support**: `agentHooks/` provides adapters for Claude, Codex, Cursor, Copilot, Gemini, Grok, Hermes, Droid, Antigravity - each agent runs in a terminal with hooks for status detection
- **Agent catalog**: `src/renderer/lib/agentCatalog.ts` defines supported agents; `agentDetection.ts` identifies agent type from terminal output; `agentStatusOsc.ts` parses OSC sequences for status
- SDK events streamed to renderer via IPC, handled in `initClaudeEventListener()` (`store/sessions/eventHandler.ts`)
- Custom events beyond SDK: `init`, `slashCommands`, `done`, `waiting_input`
- Tool results arrive as `user` events, attached to preceding assistant message's tool calls by ID
- When Claude calls `AskUserQuestion`/`ExitPlanMode`/elicitations, SDK pauses via `canUseTool()` in `agent.ts`, renderer shows inline prompts, user submits via `agent:answerToolInput` or `agent:answerElicitation` IPC
- Images: drag-drop/file-pick, stored as base64 data URIs, converted to Anthropic content blocks
- File mentions: `@` autocomplete via `MentionAutocomplete.tsx`, snippets via `SnippetChips.tsx`
- Slash commands: `/` autocomplete, fetched via `agent:getSlashCommands` IPC
- Sessions can be linked to other worktrees for cross-context awareness
- **Embedded apps**: `WebAppOverlay.tsx` hosts web apps (e.g. Spotify) inside the center panel, managed via `embeddedApps.ts`

## Sessions Store (`src/renderer/store/sessions/`)

Decomposed into focused modules. All consumers import from `@/store/sessions` (barrel). Circular imports between helpers and `store.ts` are safe - store singleton is created at module evaluation time.

Key files: `store.ts` (state + actions), `storeTypes.ts`, `eventHandler.ts` (IPC dispatch), `stateUtils.ts` (`updateSession` atomic helper), `helpers.ts` (message parsing), `persistence.ts`, `storage.ts`, `streaming.ts` (150ms buffer flush), `selectors.ts`, `activity.ts`.

Handlers directory (`handlers/`): one file per concern - `sessionLifecycleActions`, `communicationActions`, `draftActions`, `userInputActions`, `modelSettingsActions`, `rollbackActions`, `worktreeLinkActions`, `worktreeSync`, `handleMessages`, `handleStreaming`, `handleDone`, `handleWaiting`, `handleLifecycle`, `handleCompaction`, `commandParser`, `communicationHelpers`, `sessionLifecycleHelpers`, `notifications`, `titleManager`, `tokenUtils`, `toolResultParser`, `authErrorActions`.

## Settings UI Conventions

Every settings page must follow these patterns:

#### Page skeleton

```tsx
export function SettingsMyPage() {
  const { t } = useTranslation('settings')
  return (
    <div className="settings-section">
      <h4 className="settings-section-subtitle">{t('myPage.sectionHeader')}</h4>
      <div className="settings-field settings-field--row">
        <label className="settings-label">{t('myPage.someSetting')}</label>
        <Toggle checked={value} onChange={setValue} />
      </div>
      <div className="settings-divider" />
      <div className="settings-card">
        <p className="settings-card-title">{t('myPage.groupLabel')}</p>
      </div>
    </div>
  )
}
```

#### Controls

| Situation | Component | Never use |
|-----------|-----------|-----------|
| Boolean toggle | `<Toggle>` from `shared/Toggle` | `<input type="checkbox">` |
| 2-4 mutually exclusive | `<SegmentedControl>` from `shared/SegmentedControl` | `<input type="radio">` |
| 5+ options | `<select className="settings-select">` | - |
| Free text | `<input className="settings-input">` | - |
| Long text | `<textarea className="settings-textarea">` | - |
| Numeric stepper | `<div className="settings-stepper">` with +/- buttons | `<input type="number">` alone |

#### State: 0-1 fields use `useState`, 2+ use `useReducer`. Persist text on `onBlur`, toggles immediately.

#### Existing settings pages

General, Appearance, AI, Editor, Git, GitHub, Jira, Mobile, Notifications, Analytics, Experimental, About, Project, ProjectCopyFiles, ProjectGitIdentity, ProjectLsp, RunScripts, Apps, ClaudeHooks, ClaudeInstructions, ClaudeMcp/ (decomposed: McpServerForm, McpServerRow, KvPairRows, mcpReducer), ClaudePermissions, ClaudePlugins, ClaudeSkills.

#### Adding a new settings page

1. Create `Settings/SettingsMyPage.tsx` using the skeleton above
2. Add translations to `locales/{en,ja,id,zh}/settings.json`
3. Add to `sectionMap` in `SettingsOverlay.tsx`
4. Add to the relevant group in `NAV_GROUPS` in `SettingsNav.tsx`

## Project & Worktree Creation

**Adding projects** - `AddProjectDialog/` is a tabbed dialog (Local, GitHub, QuickStart):
- LocalTab: browse or drag-drop a local repo
- GitHubTab: clone from GitHub URL
- QuickStartTab: scaffold from built-in templates via `templates.ts`

**Worktree creation** - `AddWorktreeDialog.tsx`:
- Fetches remote branches via `ipc.git.getRemoteBranches`
- Git command: `git worktree add -b <localBranch> <path> <originBranch>`
- Storage path: `~/Braid/worktrees/{project}/{branch}/`
- Random branch name reroll to Japanese city names (`lib/randomBranch.ts`)
- Copy files from main worktree via `CopyFilesSection` (e.g. .env, node_modules)

## Search & Replace

Full-project search powered by ripgrep (`src/main/services/search.ts`):
- Content search with regex, case sensitivity, whole word, include/exclude glob filters
- Find and replace (single file or bulk) via `SearchView/` in the right panel
- Types shared in `src/shared/search.ts`

## Mobile Companion Server

`src/main/services/mobileServer/` - pair physical mobile devices to Braid:
- E2E encrypted pairing via `e2ee.ts` with public key exchange
- mDNS discovery (`discovery.ts`) for LAN device detection
- JSON-RPC protocol (`rpc.ts`, `protocol.ts`) for device communication
- Device store persistence (`deviceStore.ts`)
- MCP bridge (`mobileMcp.ts`) exposes device to Claude as an MCP tool
- UI in `SettingsMobile.tsx` and `DeviceToolbar.tsx`

## PTY Daemon

`src/main/services/ptyDaemon/` - persistent terminal sessions that survive app restarts:
- Unix domain socket server (`socketServer.ts`) for terminal I/O
- Session checkpointing (`checkpoint.ts`) for scrollback persistence
- Lifecycle management (`lifecycle.ts`) - spawn, reattach, kill
- Client adapter (`adapter.ts`) wraps node-pty with daemon protocol
- Reattach support via `ipc.pty.reattach` and `ipc.pty.listSessions`

## Auto-Update

`src/main/services/autoUpdate.ts` + `src/renderer/store/updater.ts`:
- Electron autoUpdater integration with download progress tracking
- `UpdateDialog` in shared components shows release notes
- Preload exposes `api.updater.{check,download,install}` + event listeners

## GitHub Authentication

`src/main/services/githubAuth.ts` - GitHub OAuth device flow:
- `api.github.startDeviceFlow` returns user code + verification URI
- `GhAuthDialog` in shared components guides user through flow
- Also supports `api.github.feedGhToken` for manual PAT entry

## Internationalization (i18n)

- **i18next** + **react-i18next**, config in `src/renderer/lib/i18n.ts`
- Languages: English (`en`), Japanese (`ja`), Indonesian (`id`), Chinese (`zh`). Fallback: English.
- Namespaces: `common`, `center`, `sidebar`, `right`, `missionControl`, `settings`, `shortcuts`

### Adding New Strings

1. Add the key to **all four** `en/<ns>.json`, `ja/<ns>.json`, `id/<ns>.json`, `zh/<ns>.json`
2. Use `useTranslation('<namespace>')` and call `t('yourKey')`
3. For plurals: `"key_one": "1 item"`, `"key_other": "{{count}} items"`
4. Outside React: `import i18n from '@/lib/i18n'; i18n.t('key', { ns: 'center' })`

## Test-Driven Development

Follow TDD where practical: write test first, Red -> Green -> Refactor. Tests in `__tests__/` adjacent to module. Run with `yarn test <pattern>`. Skip TDD only for pure UI/visual, IPC wiring, or Electron native APIs. Reference suites: `store/sessions/handlers/__tests__/`, `services/git/__tests__/`, `lib/__tests__/`.

## Design System

### Design Tokens (`src/renderer/styles/tokens.css`)

All new CSS must use design tokens. **Never hardcode** pixel values for font-size, font-weight, border-radius, z-index, transition duration, or spacing.

| Category | Tokens | Example |
|----------|--------|---------|
| Spacing | `--space-{0..40}` | `--space-8`, `--space-16` |
| Font size | `--text-{2xs..5xl}` | `--text-md` (13px), `--text-base` (12px) |
| Font weight | `--weight-{normal,medium,semibold,bold}` | `--weight-semibold` |
| Radius | `--radius-{xs,sm,,lg,xl,pill,full}` | `--radius`, `--radius-lg` |
| Shadow | `--shadow-elevation-{xs..2xl}`, `--shadow-focus` | `--shadow-elevation-lg` |
| Duration | `--duration-{instant,fast,normal,slow,slower}` | `--duration-fast` |
| Z-index | `--z-{base,raised,dropdown,sticky,overlay,modal,toast,flash,popover,lightbox}` | `--z-overlay` |

Color tokens are runtime-generated by `applyTheme()` in `src/renderer/themes/apply.ts`. Theme palettes live in `themes/palettes/`, with helpers for terminal colors (`deriveTerminal.ts`, `terminal.ts`), Monaco editor (`monaco.ts`), and VS Code theme import (`vscode.ts`).

### Component Library (`src/renderer/components/ui/`)

**Always use these** instead of raw HTML + CSS classes:

```tsx
import { Button, Dialog, Spinner, Badge, Card, Combobox, AsyncCombobox, EmptyState, FormField, SectionHeader, SkeletonRows, StatusDot, BouncingDots, WaveformBars, CoachMark, SpotlightTour } from '@/components/ui'
```

`Button` replaces `<button className="btn">`, `Dialog` replaces manual overlay divs, `Combobox`/`AsyncCombobox` for searchable dropdowns, `FormField` for settings fields, `Spinner` for all loading states. Shared components (`Toggle`, `SegmentedControl`, `Tooltip`, `ContextMenu`, `ResizeHandle`, `Checkbox`) remain in `components/shared/`.

## Documentation Website (`website/`)

Separate Docusaurus 3 project with own `package.json` and `yarn.lock`. Run `cd website && yarn start` for dev. Docs in `website/docs/`, config in `docusaurus.config.ts` and `sidebars.ts`.

## Conventions

- **File size limit**: Max **450 lines** per file. Decompose into directory module with barrel `index.ts` if exceeded.
- **Zustand store updates**: Always read fresh state inside `setState` callbacks. Never capture a session snapshot outside `setState` and spread it inside - causes stale-capture bugs. Use `updateSession()` from `stateUtils.ts`.
- **useState limit**: Max 2 `useState` calls per component. 3+ must use `useReducer` or Zustand store.
- **`useShallow` safety**: Never create new objects inside a `useShallow` selector (`.map(() => ({...}))` causes infinite re-renders). Select raw data, transform with `useMemo`. Test with `assertSelectorStable`.
- CSS in modular stylesheets under `src/renderer/styles/` (~68 files, no CSS modules), imported via `styles/index.css`
- GitHub integration uses `gh` CLI (must be installed and authenticated), with built-in OAuth device flow fallback (`GhAuthDialog`)
- Drag-reorder for projects, worktrees, sessions, file tabs via `useTabReorder` hook
- **No inline SVG**: Import SVGs as React components or use icon library
- **Shared types**: Types used by both main and renderer go in `src/shared/`, not duplicated
- **Error boundaries**: Use `ErrorBoundary` from `shared/` to wrap major UI sections
