import type { ThemePalette } from './palettes'

/** Strip JSONC comments (// and /* ... *​/) to make it valid JSON */
function stripJsonComments(text: string): string {
  let result = ''
  let i = 0
  let inString = false
  while (i < text.length) {
    if (inString) {
      if (text[i] === '\\') {
        result += text[i] + (text[i + 1] ?? '')
        i += 2
        continue
      }
      if (text[i] === '"') inString = false
      result += text[i]
      i++
    } else {
      if (text[i] === '"') {
        inString = true
        result += text[i]
        i++
      } else if (text[i] === '/' && text[i + 1] === '/') {
        // Line comment — skip until newline
        while (i < text.length && text[i] !== '\n') i++
      } else if (text[i] === '/' && text[i + 1] === '*') {
        // Block comment
        i += 2
        while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
        i += 2 // skip closing */
      } else {
        result += text[i]
        i++
      }
    }
  }
  return result
}

/** Lighten or darken a hex color for deriving missing fields */
function adjustBrightness(hex: string, amount: number): string {
  const r = Math.min(255, Math.max(0, parseInt(hex.slice(1, 3), 16) + amount))
  const g = Math.min(255, Math.max(0, parseInt(hex.slice(3, 5), 16) + amount))
  const b = Math.min(255, Math.max(0, parseInt(hex.slice(5, 7), 16) + amount))
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

/** Normalize any CSS color to 6-digit hex, stripping alpha if present */
function normalizeHex(color: string): string {
  if (!color) return color
  const c = color.trim()
  // Already #rrggbb
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return c
  // #rrggbbaa — strip alpha
  if (/^#[0-9a-fA-F]{8}$/.test(c)) return c.slice(0, 7)
  // #rgb
  if (/^#[0-9a-fA-F]{3}$/.test(c)) {
    return '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3]
  }
  // #rgba
  if (/^#[0-9a-fA-F]{4}$/.test(c)) {
    return '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3]
  }
  return c
}

/** Look up a TextMate token color from VSCode tokenColors rules */
function tokenColor(
  tokenColors: Array<{ scope?: string | string[]; settings?: { foreground?: string } }>,
  scopes: string[]
): string | undefined {
  for (const scope of scopes) {
    for (const rule of tokenColors) {
      const ruleScopes = Array.isArray(rule.scope)
        ? rule.scope
        : rule.scope
          ? [rule.scope]
          : []
      if (ruleScopes.some((s) => s === scope || s.startsWith(scope + '.'))) {
        const fg = rule.settings?.foreground
        if (fg) return normalizeHex(fg)
      }
    }
  }
  return undefined
}

export function importVSCodeTheme(jsonText: string, fileName: string): ThemePalette {
  const clean = stripJsonComments(jsonText)
  const parsed = JSON.parse(clean) as {
    name?: string
    type?: string
    colors?: Record<string, string>
    tokenColors?: Array<{ scope?: string | string[]; settings?: { foreground?: string } }>
  }

  const colors = parsed.colors ?? {}
  const tc = parsed.tokenColors ?? []
  const isDark = (parsed.type ?? 'dark') === 'dark'

  const bg = normalizeHex(colors['editor.background'] ?? (isDark ? '#1e1e1e' : '#ffffff'))
  const bgSecondary = normalizeHex(
    colors['sideBar.background'] ?? colors['activityBar.background'] ?? adjustBrightness(bg, isDark ? 10 : -10)
  )
  const bgTertiary = normalizeHex(
    colors['input.background'] ?? colors['editorGroupHeader.tabsBackground'] ?? adjustBrightness(bg, isDark ? 15 : -15)
  )
  const bgHover = normalizeHex(
    colors['list.hoverBackground'] ?? adjustBrightness(bg, isDark ? 20 : -20)
  )
  const border = normalizeHex(
    colors['panel.border'] ?? colors['editorGroup.border'] ?? adjustBrightness(bg, isDark ? 30 : -25)
  )
  const textPrimary = normalizeHex(
    colors['editor.foreground'] ?? colors['foreground'] ?? (isDark ? '#d4d4d4' : '#333333')
  )
  const textSecondary = normalizeHex(
    colors['descriptionForeground'] ?? colors['editorCursor.foreground'] ?? adjustBrightness(textPrimary, isDark ? -40 : 40)
  )
  const textMuted = normalizeHex(
    colors['editorLineNumber.foreground'] ?? adjustBrightness(textPrimary, isDark ? -70 : 60)
  )
  const accent = normalizeHex(
    colors['focusBorder'] ?? colors['button.background'] ?? colors['textLink.foreground'] ?? '#007acc'
  )
  const accentHover = normalizeHex(
    colors['button.hoverBackground'] ?? colors['textLink.activeForeground'] ?? adjustBrightness(accent, isDark ? 25 : -20)
  )
  const green = normalizeHex(
    colors['testing.iconPassed'] ?? colors['gitDecoration.addedResourceForeground'] ?? '#4ec9b0'
  )
  const red = normalizeHex(
    colors['errorForeground'] ?? colors['gitDecoration.deletedResourceForeground'] ?? '#f44747'
  )
  const amber = normalizeHex(
    colors['editorWarning.foreground'] ?? colors['gitDecoration.modifiedResourceForeground'] ?? '#cca700'
  )
  const olive = normalizeHex(
    colors['editorLineNumber.foreground'] ?? textMuted
  )

  // Syntax highlighting — derived from TextMate tokenColors with UI fallbacks
  const hlBase = textPrimary
  const hlComment =
    tokenColor(tc, ['comment', 'comment.line', 'comment.block']) ??
    normalizeHex(colors['editorLineNumber.foreground'] ?? textMuted)
  const hlKeyword =
    tokenColor(tc, ['keyword', 'keyword.control', 'storage.type', 'storage.modifier']) ??
    red
  const hlAttrName =
    tokenColor(tc, ['entity.name.tag', 'entity.other.attribute-name', 'support.type.property-name']) ??
    green
  const hlString =
    tokenColor(tc, ['string', 'string.quoted']) ??
    normalizeHex(isDark ? '#a5d6ff' : '#0a3069')
  const hlTitle =
    tokenColor(tc, ['entity.name.function', 'entity.name.class', 'support.function', 'support.class']) ??
    accent
  const hlType =
    tokenColor(tc, ['support.type', 'entity.name.type', 'storage.type.class']) ??
    amber
  const hlNumber =
    tokenColor(tc, ['constant.numeric', 'constant.language', 'constant.character']) ??
    accent
  const hlMeta =
    tokenColor(tc, ['meta.preprocessor', 'keyword.other.import', 'keyword.control.import']) ??
    accent
  const hlVariable =
    tokenColor(tc, ['variable', 'variable.other']) ??
    normalizeHex(isDark ? '#ffa657' : '#953800')
  const hlTag =
    tokenColor(tc, ['entity.name.tag']) ??
    red
  const hlAttr =
    tokenColor(tc, ['entity.other.attribute-name']) ??
    accent

  // Generate a stable ID from the file name
  const id = 'vscode-' + fileName
    .replace(/\.jsonc?$/i, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .toLowerCase()

  return {
    id,
    name: parsed.name ?? fileName.replace(/\.jsonc?$/i, ''),
    type: isDark ? 'dark' : 'light',
    source: 'vscode',
    colors: {
      bgPrimary: bg,
      bgSecondary,
      bgTertiary,
      bgHover,
      border,
      textPrimary,
      textSecondary,
      textMuted,
      accent,
      accentHover,
      green,
      red,
      amber,
      olive,
      hlBase,
      hlComment,
      hlKeyword,
      hlAttrName,
      hlString,
      hlTitle,
      hlType,
      hlNumber,
      hlMeta,
      hlVariable,
      hlTag,
      hlAttr
    }
  }
}
