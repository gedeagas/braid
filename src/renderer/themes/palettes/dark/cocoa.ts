import { ThemePalette } from '../types'

export const cocoa: ThemePalette = {
  id: 'cocoa',
  name: 'Cocoa',
  type: 'dark',
  source: 'builtin',
  group: 'dark',
  colors: {
    bgPrimary: '#1e1e2e',   // Base
    bgSecondary: '#181825', // Mantle
    bgTertiary: '#313244',  // Surface 0
    bgHover: '#45475a',     // Surface 1
    border: '#45475a',      // Surface 1
    textPrimary: '#cdd6f4',
    textSecondary: '#bac2de',
    textMuted: '#a6adc8',
    accent: '#89b4fa',
    accentHover: '#b4befe',
    green: '#a6e3a1',
    red: '#f38ba8',
    amber: '#f9e2af',
    olive: '#9399b2',
    hlBase: '#cdd6f4',
    hlComment: '#6c7086',
    hlKeyword: '#cba6f7',
    hlAttrName: '#a6e3a1',
    hlString: '#a6e3a1',
    hlTitle: '#89b4fa',
    hlType: '#fab387',
    hlNumber: '#fab387',
    hlMeta: '#89dceb',
    hlVariable: '#f38ba8',
    hlTag: '#f38ba8',
    hlAttr: '#b4befe'
  }
}
