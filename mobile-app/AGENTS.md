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
- The terminal's `TerminalWebView` themes with the app: it exports `TERMINAL_THEMES` (Tokyonight
  Storm for dark, Tokyonight Day for light), and the terminal screen passes
  `terminalTheme={TERMINAL_THEMES[scheme]}` so the xterm surface and its selection chrome
  switch with `useTheme().scheme`. To retune the terminal palettes, edit `DARK_TERMINAL_THEME` /
  `LIGHT_TERMINAL_THEME` in `src/terminal/TerminalWebView.tsx`.

## `src/ui/kit/` - reusable themed components

Prefer these over re-rolling styled views: `Screen` (themed safe-area container - use
`surface="panel"` when top/bottom bars are panel-colored, e.g. the terminal screen), `Button`,
`Card`, `SegmentedControl`, `Dropdown` (themed select / bottom-sheet picker). All consume
`useTheme()` and switch with light/dark for free.

# Protocol compatibility

Mobile and desktop talk over a **versioned protocol**. Because the App Store lags desktop
releases, both sides exchange version numbers on `status.get` so a genuinely incompatible
combo can hard-block instead of silently misbehaving.

## Two numbers per side, exchanged on `status.get`

- **Desktop** advertises `protocolVersion` + `minCompatibleMobileVersion` (its kill switch).
- **Mobile** holds `MOBILE_PROTOCOL_VERSION` + `MIN_COMPATIBLE_DESKTOP_VERSION`.

The verdict is computed by `evaluateCompat` in `src/transport/protocol-compat.ts` (a mirror of
the CI-tested canonical `src/shared/mobile-compat.ts` on the desktop side - keep them in sync;
Metro can't resolve outside `mobile-app/`). Precedence: the desktop's **kill switch wins**
(`mobile-too-old` over `desktop-too-old`). A newer desktop **never blocks on version alone** -
that's the whole point, so additive desktop changes don't strand older phones.

## Version bumps gate BREAKING changes only

The constants live in two mirrored files (`src/shared/mobile-protocol.ts` on desktop,
`src/transport/protocol-version.ts` on mobile).

- **Bump `MOBILE_PROTOCOL_VERSION`** when you: remove an RPC method or required param; change
  the meaning (units, nullability) of a field the other side reads; or change encryption,
  framing, or the auth handshake.
- **Do NOT bump** for additive changes: a new RPC method, a new optional field, a new
  ignorable event - or a new **capability-gated** feature. (The v3 binary-terminal channel
  was capability-gated and should never have bumped the version; a missed mobile-constant
  sync then false-triggered `mobile-too-old`. Don't repeat that.)
- **Bump the kill switch** (`MIN_COMPATIBLE_MOBILE_VERSION` desktop-side, or
  `MIN_COMPATIBLE_DESKTOP_VERSION` mobile-side) only to deliberately hard-block an old build.

## Features are gated by capabilities, not the version

The desktop advertises a `capabilities: string[]` array in `status.get`
(`MOBILE_CAPABILITIES`, mirrored as `MOBILE_CAPABILITY` ids on mobile). Gate any negotiable
feature with `desktopSupports(status, MOBILE_CAPABILITY.x)` instead of comparing protocol
versions. Add a new capability id (never reuse/renumber one) when you ship such a feature.

# Worktrees

Creating a worktree is a **modal** (`src/worktrees/CreateWorktreeModal.tsx`), opened from the
host screen's add (+) button - there is no dedicated worktree route. It mirrors the desktop
AddWorktreeDialog (project + base-branch `Dropdown`s, branch-name input, optional agent
picker; **no Jira** yet) and calls `worktrees.create`. The chosen agent is persisted as the
terminal screen's default. Removing a worktree is a **long-press** on its row in the host
screen (`worktrees.remove`); the main worktree is never removable.
