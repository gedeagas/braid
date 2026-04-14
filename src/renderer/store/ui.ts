/**
 * UI store barrel — re-exports from the store/ui/ directory module.
 *
 * The 1,036-line god store has been split into focused slices:
 *   store/ui/theme.ts      — theme, language, zoom
 *   store/ui/layout.ts     — panels, worktree selection, file tabs
 *   store/ui/terminal.ts   — terminal dimensions + settings
 *   store/ui/settings.ts   — settings overlay + all persisted settings
 *   store/ui/apps.ts       — embedded web apps + pending bottom-panel state
 *   store/ui/store.ts      — Zustand create() composing all slices
 *   store/ui/helpers.ts    — generic localStorage load utilities
 *
 * Import paths are unchanged — consumers still do:
 *   import { useUIStore } from '@/store/ui'
 */
export * from './ui/index'
