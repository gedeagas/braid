/** Shared Monaco editor options for Settings panels. */

const BASE = {
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  wordWrap: 'on' as const,
  fontSize: 13,
  renderWhitespace: 'none' as const,
  padding: { top: 8, bottom: 8 },
  overviewRulerLanes: 0,
  glyphMargin: false,
  lineDecorationsWidth: 8,
  renderLineHighlight: 'none' as const,
  contextmenu: false,
}

/** Full editor with line numbers, folding, auto vertical scrollbar. */
export const SETTINGS_EDITOR_OPTIONS = {
  ...BASE,
  lineNumbers: 'on' as const,
  scrollbar: { vertical: 'auto' as const, horizontal: 'hidden' as const },
  folding: true,
}

/** Compact editor — no line numbers, no folding, hidden scrollbar. */
export const SETTINGS_EDITOR_COMPACT = {
  ...BASE,
  lineNumbers: 'off' as const,
  scrollbar: { vertical: 'hidden' as const, horizontal: 'hidden' as const },
  folding: false,
  lineNumbersMinChars: 0,
}
