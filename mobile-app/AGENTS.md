# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code.

# Screens & deprecation

Braid Mobile is consolidating on the **terminal screen** (`src/app/terminal/[hostId].tsx`)
as the single way to drive a paired desktop. It speaks the `terminal.*` RPCs and renders a
real PTY via `TerminalWebView`.

The SDK-chat **session screens have been removed.** The old routes
(`src/app/sessions/[hostId].tsx`, `src/app/session/[hostId]/[sessionId].tsx`), the
`SESSION_SCREENS_ENABLED` flag, and every UI entrypoint to them (the home-screen "Resume"
card and the host-screen "Sessions" tile) are gone. The desktop's `sessions.*` / `agent.*`
RPCs still exist but the mobile app no longer calls them.

Do **not** re-add session/chat screens or call `sessions.*` / `agent.*` from mobile. All
work to drive a paired desktop goes through the terminal screen and the `terminal.*` RPCs.

# Theming & UI kit

All colors come from the consolidated UI kit in `src/ui/`. The app supports **light and
dark** themes; the active scheme is chosen by a persisted preference (`System` / `Light` /
`Dark`, default `System`) exposed on the Settings screen (`src/app/notifications.tsx`).

## `src/ui/theme/` - the theme system

- **`palette.ts`** - `Palette` type + `lightPalette` / `darkPalette`. **Single source of
  truth for color.** Both schemes expose the exact same keys (`bg`, `panel`, `panelStrong`,
  `border`, `text`, `muted`, `subtle`, `accent`, `accentSoft`, `success`, `danger`,
  `warning`). Add new colors here, to **both** palettes.
- **`context.tsx`** - `ThemeProvider` (mounted once in `src/app/_layout.tsx`) and
  `useTheme()`, which returns `{ palette, scheme, mode, setMode }`. The preference persists
  to `expo-secure-store` under `braid.mobile.themeMode`.
- **`useThemedStyles.ts`** - `useThemedStyles(factory)` builds a memoized StyleSheet from the
  active palette; `useShared()` returns the themed `shared` primitives.
- **`shared.ts`** - `makeShared(palette)` builds the reusable `shared.*` style primitives.

`src/constants/theme.ts` (legacy Expo-starter `Colors`) now derives from these palettes, so
there is one color source app-wide.

## Writing themed screens

**Never** import a static color or define a local `COLORS` object. Read the palette at render
time so styles switch with the theme:

```tsx
function MyScreen() {
  const { palette: c } = useTheme()
  const shared = useShared()
  const styles = useThemedStyles(makeStyles)  // makeStyles is a module-level fn
  return <Screen edges={['top','left','right']}>...</Screen>
}
function makeStyles(c: Palette) {
  return StyleSheet.create({ box: { backgroundColor: c.panel, borderColor: c.border } })
}
```

- `@/ui/theme` still exports a **deprecated static** `colors` / `shared` (the dark palette).
  These exist only for not-yet-migrated screens and never react to the theme switch - do not
  use them in new code.
- Module-level `StyleSheet.create` that references colors is the migration trap: it captures
  one palette at load. Convert it to a `makeStyles(c)` factory fed through `useThemedStyles`,
  or move the style objects inside the component so they close over `useTheme().palette`.
- The terminal's `TerminalWebView` renders its own (intentionally dark) terminal surface from
  the static palette and does not theme - that is deliberate.

## `src/ui/kit/` - reusable themed components

Prefer these over re-rolling styled views: `Screen` (themed safe-area container - use
`surface="panel"` when top/bottom bars are panel-colored, e.g. the terminal screen), `Button`,
`Card`, `SegmentedControl`, `Dropdown` (themed select / bottom-sheet picker). All consume
`useTheme()` and switch with light/dark for free.

# Worktrees

Creating a worktree is a **modal** (`src/worktrees/CreateWorktreeModal.tsx`), opened from the
host screen's add (+) button - there is no dedicated worktree route. It mirrors the desktop
AddWorktreeDialog (project + base-branch `Dropdown`s, branch-name input, optional agent
picker; **no Jira** yet) and calls `worktrees.create`. The chosen agent is persisted as the
terminal screen's default. Removing a worktree is a **long-press** on its row in the host
screen (`worktrees.remove`); the main worktree is never removable.
