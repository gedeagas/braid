export type ThemeGroup = 'default' | 'dark' | 'light' | 'accessibility'

export interface ThemePalette {
  id: string
  name: string
  type: 'dark' | 'light'
  source: 'builtin' | 'vscode' | 'custom'
  group?: ThemeGroup
  colors: {
    bgPrimary: string
    bgSecondary: string
    bgTertiary: string
    bgHover: string
    border: string
    textPrimary: string
    textSecondary: string
    textMuted: string
    accent: string
    accentHover: string
    green: string
    red: string
    amber: string
    olive: string
    // Syntax highlighting (highlight.js)
    hlBase: string // default code text
    hlComment: string // comments, quotes
    hlKeyword: string // keywords, selectors, literals
    hlAttrName: string // attribute names, tag names
    hlString: string // strings, doctags, regexps
    hlTitle: string // function/class titles, built-ins
    hlType: string // types
    hlNumber: string // numbers, symbols, bullets
    hlMeta: string // meta keywords
    hlVariable: string // variables, template variables
    hlTag: string // HTML/XML tags
    hlAttr: string // HTML/XML attributes
  }
}
