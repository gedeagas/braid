import { ThemePalette } from '../types'

export const protanopiaLight: ThemePalette = {
  id: 'protanopia-light',
  name: 'Protanopia Light',
  type: 'light',
  source: 'builtin',
  group: 'accessibility',
  colors: {
    bgPrimary: '#fafbfc',
    bgSecondary: '#f0f2f5',
    bgTertiary: '#e4e7ec',
    bgHover: '#d8dce3',
    border: '#c8cdd6',
    textPrimary: '#2c3240',
    textSecondary: '#5a6170',
    textMuted: '#8690a0',
    accent: '#0860bf',
    accentHover: '#0550a0',
    green: '#b35d00', // dark orange (safe for red-green)
    red: '#0860bf', // blue (safe for red-green)
    amber: '#8a6d00',
    olive: '#5a6170',
    hlBase: '#2c3240',
    hlComment: '#8690a0',
    hlKeyword: '#b35d00',
    hlAttrName: '#0860bf',
    hlString: '#0860bf',
    hlTitle: '#7b40c0',
    hlType: '#b35d00',
    hlNumber: '#7b40c0',
    hlMeta: '#0550a0',
    hlVariable: '#b35d00',
    hlTag: '#0860bf',
    hlAttr: '#7b40c0'
  },
  terminal: {
    black: '#2c3240',
    red: '#0860bf',
    green: '#b35d00',
    yellow: '#8a6d00',
    blue: '#0860bf',
    magenta: '#7b40c0',
    cyan: '#0550a0',
    white: '#8690a0',
    brightBlack: '#5a6170',
    brightRed: '#1a78d4',
    brightGreen: '#c87218',
    brightYellow: '#a08218',
    brightBlue: '#1a78d4',
    brightMagenta: '#9058d0',
    brightCyan: '#1668b8',
    brightWhite: '#fafbfc'
  }
}
