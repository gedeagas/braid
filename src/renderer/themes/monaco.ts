import type { ThemePalette } from './palettes'
import type { editor } from 'monaco-editor'

export function buildMonacoTheme(palette: ThemePalette): editor.IStandaloneThemeData {
  const c = palette.colors
  const hex = (s: string) => s.replace('#', '')
  return {
    base: palette.type === 'dark' ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [
      { token: '', foreground: hex(c.hlBase) },
      { token: 'comment', foreground: hex(c.hlComment), fontStyle: 'italic' },
      { token: 'keyword', foreground: hex(c.hlKeyword) },
      { token: 'string', foreground: hex(c.hlString) },
      { token: 'number', foreground: hex(c.hlNumber) },
      { token: 'type', foreground: hex(c.hlType) },
      { token: 'variable', foreground: hex(c.hlVariable) },
      { token: 'tag', foreground: hex(c.hlTag) },
      { token: 'attribute.name', foreground: hex(c.hlAttrName) },
      { token: 'metatag', foreground: hex(c.hlMeta) },
    ],
    colors: {
      'editor.background': c.bgPrimary,
      'editor.foreground': c.textPrimary,
      'editorLineNumber.foreground': c.textMuted,
      'editorLineNumber.activeForeground': c.textSecondary,
      'editorCursor.foreground': c.accent,
      'editor.selectionBackground': c.accent + '33',
      'editor.lineHighlightBackground': c.bgSecondary,
      'editorIndentGuide.background1': c.border,
      'editorIndentGuide.activeBackground1': c.textMuted,
      'scrollbarSlider.background': c.border + '80',
      'scrollbarSlider.hoverBackground': c.textMuted + '80',
      'scrollbarSlider.activeBackground': c.accent + '80',
    }
  }
}
