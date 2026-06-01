# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code.

# Screens & deprecation

Braid Mobile is consolidating on the **terminal screen** (`src/app/terminal/[hostId].tsx`)
as the single way to drive a paired desktop. It speaks the `terminal.*` RPCs and renders a
real PTY via `TerminalWebView`.

The SDK-chat **session screens are deprecated**:

- `src/app/sessions/[hostId].tsx` - session list
- `src/app/session/[hostId]/[sessionId].tsx` - session detail (chat/control)

They speak `sessions.*` / `agent.*` RPCs. The route files remain for backward-compatible
deep links, but every UI entrypoint to them is gated behind `SESSION_SCREENS_ENABLED`
in `src/constants/features.ts` (currently `false`). The previously surfaced entrypoints
were: the "Resume" card on the home screen (`src/app/index.tsx`) and the "Sessions" nav
tile + "Recent sessions" list on the host screen (`src/app/host/[hostId].tsx`).

Do **not** add new entrypoints to the session routes. New work targets the terminal screen.
