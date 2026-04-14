import { ThemePalette } from '../types'

export const tritanopiaDark: ThemePalette = {
  id: 'tritanopia-dark',
  name: 'Tritanopia Dark',
  type: 'dark',
  source: 'builtin',
  group: 'accessibility',
  colors: {
    bgPrimary: '#1c1a20',
    bgSecondary: '#161419',
    bgTertiary: '#24212a',
    bgHover: '#2e2a35',
    border: '#3d384a',
    textPrimary: '#e4e0ed',
    textSecondary: '#a09bb0',
    textMuted: '#706b80',
    accent: '#e85d75',
    accentHover: '#f07a90',
    green: '#5bc8af', // teal (safe for blue-yellow)
    red: '#e85d75', // pink-red (safe for blue-yellow)
    amber: '#d46b6b', // salmon (safe for blue-yellow)
    olive: '#706b80',
    hlBase: '#e4e0ed',
    hlComment: '#706b80',
    hlKeyword: '#e85d75',
    hlAttrName: '#5bc8af',
    hlString: '#5bc8af',
    hlTitle: '#c49aff',
    hlType: '#e85d75',
    hlNumber: '#c49aff',
    hlMeta: '#5bc8af',
    hlVariable: '#d46b6b',
    hlTag: '#e85d75',
    hlAttr: '#c49aff'
  }
}
