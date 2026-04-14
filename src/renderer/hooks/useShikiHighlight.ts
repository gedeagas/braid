// ---------------------------------------------------------------------------
// Hook for deferred syntax highlighting of diff lines via Shiki.
// Returns null initially (caller shows plain text), then an array of
// per-line HTML strings once highlighting completes in an idle callback.
// ---------------------------------------------------------------------------

import { useState, useEffect } from 'react'
import { highlightLines, extToShikiLang } from '@/lib/shikiHighlighter'

/**
 * Asynchronously highlight an array of code lines using Shiki.
 *
 * @param lines - Content strings from diff lines (one per diff line)
 * @param filePath - File path used to detect the language
 * @returns Array of per-line HTML strings, or null while loading/unsupported
 */
export function useShikiHighlight(
  lines: string[],
  filePath: string | null,
): string[] | null {
  const [htmlLines, setHtmlLines] = useState<string[] | null>(null)

  const lang = filePath ? extToShikiLang(filePath) : null

  useEffect(() => {
    setHtmlLines(null)
    if (!lang || lines.length === 0) return

    let cancelled = false

    const run = async () => {
      try {
        const code = lines.join('\n')
        const result = await highlightLines(code, lang)
        if (!cancelled) setHtmlLines(result)
      } catch {
        // Highlight failed - leave as null, caller shows plain text
      }
    }

    // Schedule via requestIdleCallback to avoid blocking the main thread
    if (typeof requestIdleCallback === 'function') {
      const handle = requestIdleCallback(() => { run() }, { timeout: 500 })
      return () => { cancelled = true; cancelIdleCallback(handle) }
    }

    const handle = setTimeout(() => { run() }, 0)
    return () => { cancelled = true; clearTimeout(handle) }
  }, [lines, lang])

  return htmlLines
}
