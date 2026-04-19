export type ShortcutCategory = 'general' | 'view' | 'navigation'

export interface ShortcutDef {
  id: string
  symbols: string[]
  category: ShortcutCategory
}

export const SHORTCUT_CATEGORIES: ShortcutCategory[] = ['general', 'view', 'navigation']

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
  { id: 'closeTab', symbols: ['⌘', 'W'], category: 'navigation' },
  { id: 'previousTab', symbols: ['⌘', '⇧', '['], category: 'navigation' },
  { id: 'nextTab', symbols: ['⌘', '⇧', ']'], category: 'navigation' },
  { id: 'goToTab', symbols: ['⌘', '1-9'], category: 'navigation' },
  { id: 'quickOpen', symbols: ['⌘', 'P'], category: 'navigation' },
  { id: 'focusChat', symbols: ['⌘', 'L'], category: 'navigation' },
  { id: 'saveFile', symbols: ['⌘', 'S'], category: 'navigation' },
]
