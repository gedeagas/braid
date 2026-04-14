/**
 * Combined UIState type — union of all slice types.
 *
 * Defined here (not in store.ts) so individual slice files can import
 * UIState for StateCreator typing without creating a runtime circular
 * dependency. All imports here are type-only and are erased at compile time.
 */
import type { ThemeSlice } from './theme'
import type { LayoutSlice } from './layout'
import type { TerminalSlice } from './terminal'
import type { SettingsSlice } from './settings'
import type { AppsSlice } from './apps'

export type UIState = ThemeSlice & LayoutSlice & TerminalSlice & SettingsSlice & AppsSlice
