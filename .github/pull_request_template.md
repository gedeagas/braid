## Summary

<!-- What does this PR do? 1-3 bullet points. -->

-

## Layers touched

<!-- Check which layers this PR modifies. Helps reviewers know what to look at. -->

- [ ] **Main process** (`src/main/`) — services, IPC handlers
- [ ] **Preload** (`src/preload/`) — context bridge API
- [ ] **Renderer** (`src/renderer/`) — components, stores, lib
- [ ] **Styles** (`App.css`)

## Changes

<!-- Key files changed and why. Group by area if helpful. -->

**Sidebar / Center / Right panel:**
-

**Stores** (`projects.ts` / `sessions.ts` / `ui.ts`):
-

**Services** (`git.ts` / `claude.ts` / `github.ts` / `pty.ts`):
-

**IPC** (`main/ipc.ts` → `preload/index.ts` → `lib/ipc.ts`):
-

<!-- Remove sections above that don't apply. -->

## How to test

<!-- Steps to verify. Include which panel/area to look at. -->

1. `yarn dev`
2.

## Screenshots

<!-- Before/after if UI changed. Remove if not applicable. -->

## Checklist

- [ ] Self-reviewed the diff
- [ ] Tested locally with `yarn dev`
- [ ] Types pass — `yarn typecheck`
- [ ] No console errors or warnings in DevTools
- [ ] IPC changes are threaded through all 3 layers (main → preload → renderer)
- [ ] New state is added to the correct Zustand store
