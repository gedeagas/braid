// ---------------------------------------------------------------------------
// Hook for deferred syntax highlighting via highlight.js.
// Returns null initially (caller shows plain text), then the highlighted
// HTML string once highlighting completes in an idle callback.
// ---------------------------------------------------------------------------

import { useState, useEffect, useRef } from 'react'
import hljs from 'highlight.js/lib/core'

/**
 * Asynchronously highlight code using highlight.js.
 *
 * Returns `null` initially so the caller renders plain text. Once the
 * browser is idle, the highlight runs and the HTML result is returned.
 * This prevents large bash commands from blocking the main thread during
 * tool call expansion.
 *
 * @param code - The source code to highlight (null to skip)
 * @param language - The highlight.js language name
 * @param enabled - Whether highlighting is enabled (default true)
 */
export function useAsyncHighlight(
  code: string | null,
  language: string,
  enabled: boolean = true,
): string | null {
  const [html, setHtml] = useState<string | null>(null)
  const handleRef = useRef<number | ReturnType<typeof setTimeout>>(0)

  useEffect(() => {
    // Reset when input changes - show plain text immediately
    setHtml(null)

    if (!enabled || !code) return

    const run = () => {
      try {
        const result = hljs.highlight(code, { language })
        setHtml(result.value)
      } catch {
        // Highlight failed - leave as null, caller shows plain text
      }
    }

    // Use requestIdleCallback if available, otherwise setTimeout(0)
    if (typeof requestIdleCallback === 'function') {
      const handle = requestIdleCallback(run, { timeout: 300 })
      handleRef.current = handle
      return () => cancelIdleCallback(handle)
    }

    const handle = setTimeout(run, 0)
    handleRef.current = handle
    return () => clearTimeout(handle as ReturnType<typeof setTimeout>)
  }, [code, language, enabled])

  return html
}
