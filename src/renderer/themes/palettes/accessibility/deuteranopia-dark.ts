import { ThemePalette } from '../types'

export const deuteranopiaDark: ThemePalette = {
  id: 'deuteranopia-dark',
  name: 'Deuteranopia Dark',
  type: 'dark',
  source: 'builtin',
  group: 'accessibility',
  colors: {
    bgPrimary: '#1a1d24',
    bgSecondary: '#141720',
    bgTertiary: '#212530',
    bgHover: '#2a2f3a',
    border: '#363d4a',
    textPrimary: '#e2e6ed',
    textSecondary: '#9ba3b0',
    textMuted: '#6b7380',
    accent: '#4a9eff',
    accentHover: '#6db3ff',
    green: '#e89a3c', // orange (safe for red-green)
    red: '#5b9fff', // blue (safe for red-green)
    amber: '#d4a340',
    olive: '#6b7380',
    hlBase: '#e2e6ed',
    hlComment: '#6b7380',
    hlKeyword: '#e89a3c',
    hlAttrName: '#4a9eff',
    hlString: '#4a9eff',
    hlTitle: '#c49aff',
    hlType: '#e89a3c',
    hlNumber: '#c49aff',
    hlMeta: '#6db3ff',
    hlVariable: '#e89a3c',
    hlTag: '#4a9eff',
    hlAttr: '#c49aff'
  },
  terminal: {
    black: '#1a1d24',
    red: '#5b9fff',
    green: '#e89a3c',
    yellow: '#d4a340',
    blue: '#4a9eff',
    magenta: '#c49aff',
    cyan: '#6db3ff',
    white: '#e2e6ed',
    brightBlack: '#6b7380',
    brightRed: '#7ab4ff',
    brightGreen: '#f0b05c',
    brightYellow: '#e0b75c',
    brightBlue: '#6db3ff',
    brightMagenta: '#d4b2ff',
    brightCyan: '#8ac4ff',
    brightWhite: '#f0f3f8'
  }
}
