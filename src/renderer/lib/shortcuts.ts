export type ShortcutCategory = 'general' | 'view' | 'navigation' | 'browser'

export interface ShortcutDef {
  id: string
  symbols: string[]
  category: ShortcutCategory
}

export const SHORTCUT_CATEGORIES: ShortcutCategory[] = ['general', 'view', 'navigation', 'browser']

export const SHORTCUTS: ShortcutDef[] = [
  // General
  { id: 'openSettings', symbols: ['⌘', ','], category: 'general' },
  { id: 'showShortcuts', symbols: ['⌘', '/'], category: 'general' },
  { id: 'toggleMissionControl', symbols: ['⌘', '⇧', 'M'], category: 'general' },
  { id: 'commandPalette', symbols: ['⌘', 'K'], category: 'general' },

  // View
  { id: 'toggleSidebar', symbols: ['⌘', 'B'], category: 'view' },
  { id: 'toggleRightPanel', symbols: ['⌘', '⇧', 'B'], category: 'view' },
  { id: 'toggleTerminal', symbols: ['⌘', 'E'], category: 'view' },
  { id: 'zoomIn', symbols: ['⌘', '='], category: 'view' },
  { id: 'zoomOut', symbols: ['⌘', '-'], category: 'view' },
  { id: 'zoomReset', symbols: ['⌘', '0'], category: 'view' },

  // Navigation
  { id: 'newChatTab', symbols: ['⌘', 'T'], category: 'navigation' },
  { id: 'newBigTerminal', symbols: ['⌘', '⇧', 'T'], category: 'navigation' },
  { id: 'closeTab', symbols: ['⌘', 'W'], category: 'navigation' },
  { id: 'previousTab', symbols: ['⌘', '⇧', '['], category: 'navigation' },
  { id: 'nextTab', symbols: ['⌘', '⇧', ']'], category: 'navigation' },
  { id: 'goToTab', symbols: ['⌘', '1-9'], category: 'navigation' },
  { id: 'quickOpen', symbols: ['⌘', 'P'], category: 'navigation' },
  { id: 'focusChat', symbols: ['⌘', 'L'], category: 'navigation' },
  { id: 'saveFile', symbols: ['⌘', 'S'], category: 'navigation' },
  { id: 'moveTabToOtherPane', symbols: ['⌘', '\\'], category: 'navigation' },

  // Browser (while a browser tab is active)
  { id: 'browserNewTab', symbols: ['⌘', 'T'], category: 'browser' },
  { id: 'browserReopenTab', symbols: ['⌘', '⇧', 'T'], category: 'browser' },
  { id: 'browserFocusAddress', symbols: ['⌘', 'L'], category: 'browser' },
  { id: 'browserFind', symbols: ['⌘', 'F'], category: 'browser' },
  { id: 'browserReload', symbols: ['⌘', 'R'], category: 'browser' },
  { id: 'browserHardReload', symbols: ['⌘', '⇧', 'R'], category: 'browser' },
  { id: 'browserBack', symbols: ['⌘', '['], category: 'browser' },
  { id: 'browserForward', symbols: ['⌘', ']'], category: 'browser' },
  { id: 'browserDevTools', symbols: ['⌘', '⌥', 'I'], category: 'browser' },
]
