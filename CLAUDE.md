# Braid

Electron desktop app (React 19 + TypeScript + Zustand) for managing Git worktrees and Claude AI sessions. Three-panel layout: sidebar (projects/worktrees), center (chat + file editor), right (files/diffs/checks/terminal/notes/simulator). Includes a Mission Control kanban board for cross-worktree oversight.

## Architecture

- **Main process** (`src/main/`): Electron window, IPC handlers, services (agent SDK, git, GitHub, files, pty, storage, sessionStorage, LSP, simulator, notes, jira, windowCapture)
- **Preload** (`src/preload/index.ts`): Context-isolated bridge exposing `api.{storage,git,agent,pty,github,jira,sessions,shell,files,claudeCli,dialog,window,claudeConfig,menu,notes,lsp,settings,simulator,scripts,windowCapture}`
- **Renderer** (`src/renderer/`): React UI with Zustand stores
- **IPC flow**: changes must be threaded through all 3 layers (`src/main/ipc.ts` -> `src/preload/index.ts` -> `src/renderer/lib/ipc.ts`)

## Key Directories

```
src/main/services/
  git/              # Modular: core, branches, config, status, operations, worktrees, types
  agentWorker/      # Worker thread management: core, errorClassifier, mcp, tools
  lsp/              # LSP server lifecycle: detect, download, helpers, operations, pool, types
  agent.ts          # Main agent orchestration
  agentGenerate.ts  # Content generation helpers
  agentPermissions.ts # Tool permission allow/deny lists
  agentProcess.ts   # Agent process management
  braidMcp.ts       # In-process MCP server for Claude SDK
  claudeConfig.ts   # Claude config (permissions, hooks, skills, MCP)
  files.ts          # File operations
  github.ts         # GitHub API (gh CLI wrapper)
  pty.ts            # Pseudo-terminal (node-pty)
  sessionStorage.ts # Session persistence to ~/Braid/sessions/
  simulator.ts      # iOS Simulator control
  storage.ts        # Main-process settings/project persistence

src/main/lib/       # Utilities: logger, serviceCache, binaryFile

src/renderer/store/
  sessions/         # Decomposed Zustand store with handlers/ directory
  ui/               # UI preferences: layout, theme, terminal, settings, apps slices
  missionControl.ts # Kanban board state
  prCache.ts        # PR status caching (60s refresh)
  projects.ts       # Projects + worktrees store
  flash.ts          # Ephemeral toast notifications
  toasts.ts         # Rich toast notifications

src/renderer/components/
  Center/           # ChatView, ChatMessage, ChatHeader, ChatInput, ChatMessageList, ToolCallGroup/, SessionTabBar, BranchBar, StreamingMarkdown, DiffReviewView, SlashAutocomplete, MentionAutocomplete, ModelSelector
  Right/            # RightPanel, FileTree, FileViewer, ChangesView, ChecksView, TabbedTerminal, NotesView, SimulatorView, DiagnosticsPanel, PrMergeBar, JiraSection
  Sidebar/          # SidebarView, ProjectList, WorktreeRow, AddProjectDialog, AddWorktreeDialog, ActivityBar
  MissionControl/   # KanbanColumn, SessionCard, PrCard, McFilterBar
  Onboarding/       # OnboardingOverlay, FeatureTour, SimulatorTour
  Settings/         # SettingsOverlay, SettingsNav, and per-page components
  shared/           # Toggle, SegmentedControl, ContextMenu, Tooltip, ResizeHandle, Checkbox, icons/
  ui/               # Button, Dialog, Spinner, Badge, Card, Combobox, EmptyState, FormField, etc.

src/renderer/hooks/    # useTabReorder, useChatScroll, useGesture, useLspProviders, etc.
src/renderer/lib/      # ipc, i18n, branchValidation, kanbanColumns, sounds, shortcuts, constants, etc.
src/renderer/types/    # session.ts, git.ts, ui.ts, claude-config.ts, lsp.ts (re-exported via index.ts)
src/renderer/locales/  # en/, ja/, id/ - namespaces: common, center, sidebar, right, missionControl, settings, shortcuts
src/renderer/styles/   # Modular CSS stylesheets imported via styles/index.css
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

## Claude Integration

- Uses `@anthropic-ai/claude-agent-sdk` in main process (`src/main/services/agent.ts`)
- SDK events streamed to renderer via IPC, handled in `initClaudeEventListener()` (`store/sessions/eventHandler.ts`)
- Custom events beyond SDK: `init`, `slashCommands`, `done`, `waiting_input`
- Tool results arrive as `user` events, attached to preceding assistant message's tool calls by ID
- When Claude calls `AskUserQuestion`/`ExitPlanMode`, SDK pauses via `canUseTool()` in `agent.ts`, renderer shows inline prompts, user submits via `agent:answerToolInput` IPC
- Images: drag-drop/file-pick, stored as base64 data URIs, converted to Anthropic content blocks
- File mentions: `@` autocomplete via `MentionAutocomplete.tsx`, snippets via `SnippetChips.tsx`
- Slash commands: `/` autocomplete, fetched via `agent:getSlashCommands` IPC
- Sessions can be linked to other worktrees for cross-context awareness

## Sessions Store (`src/renderer/store/sessions/`)

Decomposed into focused modules. All consumers import from `@/store/sessions` (barrel). Circular imports between helpers and `store.ts` are safe - store singleton is created at module evaluation time.

Key files: `store.ts` (state + actions), `storeTypes.ts`, `eventHandler.ts` (IPC dispatch), `stateUtils.ts` (`updateSession` atomic helper), `helpers.ts` (message parsing), `persistence.ts`, `streaming.ts` (150ms buffer flush), `selectors.ts`, `handlers/` (one file per concern).

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

#### Adding a new settings page

1. Create `Settings/SettingsMyPage.tsx` using the skeleton above
2. Add translations to `locales/{en,ja,id}/settings.json`
3. Add to `sectionMap` in `SettingsOverlay.tsx`
4. Add to the relevant group in `NAV_GROUPS` in `SettingsNav.tsx`

## Worktree Creation

- `AddWorktreeDialog.tsx` fetches remote branches via `ipc.git.getRemoteBranches`
- Git command: `git worktree add -b <localBranch> <path> <originBranch>`
- Storage path: `~/Braid/worktrees/{project}/{branch}/`
- Random branch name reroll to Japanese city names (`lib/randomBranch.ts`)

## Internationalization (i18n)

- **i18next** + **react-i18next**, config in `src/renderer/lib/i18n.ts`
- Languages: English (`en`), Japanese (`ja`), Indonesian (`id`). Fallback: English.
- Namespaces: `common`, `center`, `sidebar`, `right`, `missionControl`, `settings`, `shortcuts`

### Adding New Strings

1. Add the key to **all three** `en/<ns>.json`, `ja/<ns>.json`, `id/<ns>.json`
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

Color tokens are runtime-generated by `applyTheme()` in `themes/apply.ts`.

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
- CSS in modular stylesheets under `src/renderer/styles/` (no CSS modules), imported via `styles/index.css`
- GitHub integration uses `gh` CLI (must be installed and authenticated)
- Drag-reorder for projects, worktrees, sessions, file tabs via `useTabReorder` hook
- **No inline SVG**: Import SVGs as React components or use icon library
