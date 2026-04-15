import { useRef, useMemo, useState, useCallback, useEffect, memo } from 'react'
import { createPortal } from 'react-dom'
import { useAsyncHighlight } from '@/hooks/useAsyncHighlight'
import { extToHljsLang } from './ToolCallGroup/toolMeta'

export interface DiffChunk {
  oldString: string
  newString: string
}

interface Props {
  filePath: string
  chunks: DiffChunk[]
  anchorRect: DOMRect
  onMouseEnter: () => void
  onMouseLeave: () => void
}

const MAX_LINES = 20
const POPOVER_WIDTH = 480

/**
 * Floating popover that shows a syntax-highlighted diff preview.
 * Rendered as a portal, positioned relative to the anchor badge.
 */
export const DiffPreviewPopover = memo(function DiffPreviewPopover({
  filePath,
  chunks,
  anchorRect,
  onMouseEnter,
  onMouseLeave,
}: Props) {
  // Build a flat list of diff lines from all chunks, truncating if needed.
  const { lines, truncated } = useMemo(() => {
    const result: Array<{ type: 'del' | 'add' | 'sep'; text: string }> = []
    let count = 0

    for (let ci = 0; ci < chunks.length; ci++) {
      const chunk = chunks[ci]
      if (ci > 0) {
        result.push({ type: 'sep', text: '' })
      }

      const oldLines = chunk.oldString ? chunk.oldString.split('\n') : []
      const newLines = chunk.newString ? chunk.newString.split('\n') : []

      for (const line of oldLines) {
        if (count >= MAX_LINES) return { lines: result, truncated: true }
        result.push({ type: 'del', text: line })
        count++
      }
      for (const line of newLines) {
        if (count >= MAX_LINES) return { lines: result, truncated: true }
        result.push({ type: 'add', text: line })
        count++
      }
    }
    return { lines: result, truncated: false }
  }, [chunks])

  // Concatenate del and add lines separately for syntax highlighting,
  // and build index maps for O(1) lookup during render
  const { delText, addText, delHtmlMap, addHtmlMap } = useMemo(() => {
    const delParts: string[] = []
    const addParts: string[] = []
    const delIdx = new Map<number, number>() // line index -> position in delParts
    const addIdx = new Map<number, number>()

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]
      if (l.type === 'del') {
        delIdx.set(i, delParts.length)
        delParts.push(l.text)
      } else if (l.type === 'add') {
        addIdx.set(i, addParts.length)
        addParts.push(l.text)
      }
    }
    return {
      delText: delParts.join('\n'),
      addText: addParts.join('\n'),
      delHtmlMap: delIdx,
      addHtmlMap: addIdx,
    }
  }, [lines])

  const lang = extToHljsLang(filePath)
  const enabled = lang != null
  const highlightedDel = useAsyncHighlight(delText || null, lang ?? 'plaintext', enabled)
  const highlightedAdd = useAsyncHighlight(addText || null, lang ?? 'plaintext', enabled)

  const delHtmlLines = useMemo(() => highlightedDel?.split('\n') ?? null, [highlightedDel])
  const addHtmlLines = useMemo(() => highlightedAdd?.split('\n') ?? null, [highlightedAdd])

  // O(1) lookup: line index -> highlighted HTML
  const htmlForLine = useCallback((lineIdx: number, type: 'del' | 'add'): string | null => {
    if (type === 'del' && delHtmlLines) {
      const pos = delHtmlMap.get(lineIdx)
      return pos != null ? (delHtmlLines[pos] ?? '') : null
    }
    if (type === 'add' && addHtmlLines) {
      const pos = addHtmlMap.get(lineIdx)
      return pos != null ? (addHtmlLines[pos] ?? '') : null
    }
    return null
  }, [delHtmlLines, addHtmlLines, delHtmlMap, addHtmlMap])

  // Position: above if anchor is in bottom half of viewport, below otherwise.
  // Sets --slide-dir so CSS animation slides toward the anchor.
  const { posStyle, opensAbove } = useMemo(() => {
    const gap = 6
    let left = anchorRect.left + anchorRect.width / 2 - POPOVER_WIDTH / 2
    left = Math.max(8, Math.min(left, window.innerWidth - POPOVER_WIDTH - 8))

    const anchorMid = anchorRect.top + anchorRect.height / 2
    const above = anchorMid > window.innerHeight / 2
    const pos = above
      ? { bottom: window.innerHeight - anchorRect.top + gap, left, width: POPOVER_WIDTH }
      : { top: anchorRect.bottom + gap, left, width: POPOVER_WIDTH }
    return { posStyle: pos, opensAbove: above }
  }, [anchorRect])

  if (lines.length === 0) return null

  return createPortal(
    <div
      className={`diff-preview-popover hljs ${opensAbove ? 'diff-preview-popover--above' : ''}`}
      style={posStyle}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="diff-preview-popover-scroll">
        <div className="diff-preview-lines">
          {lines.map((line, i) => {
            if (line.type === 'sep') {
              return <div key={`sep-${i}`} className="diff-preview-sep" />
            }
            const cls = line.type === 'del' ? 'diff-line diff-line-del' : 'diff-line diff-line-add'
            const gutter = line.type === 'del' ? '-' : '+'
            const html = htmlForLine(i, line.type)

            return (
              <div key={i} className={cls}>
                <span className="diff-line-gutter">{gutter}</span>
                <span
                  className="diff-line-content"
                  {...(html != null
                    ? { dangerouslySetInnerHTML: { __html: html } }
                    : { children: line.text }
                  )}
                />
              </div>
            )
          })}
          {truncated && (
            <div className="diff-preview-truncated">...</div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
})

/**
 * Hook to manage hover state for a diff preview popover.
 * Handles the badge <-> popover bridge (mouse can move between them without closing).
 * Dismisses on scroll to avoid stale positioning.
 */
export function useDiffPreviewHover(delay = 250) {
  const [visible, setVisible] = useState(false)
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const badgeRef = useRef<HTMLSpanElement>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const dismiss = useCallback(() => {
    clearTimer()
    setVisible(false)
  }, [clearTimer])

  const onBadgeEnter = useCallback(() => {
    clearTimer()
    timerRef.current = setTimeout(() => {
      if (!badgeRef.current) return
      setAnchorRect(badgeRef.current.getBoundingClientRect())
      setVisible(true)
    }, delay)
  }, [clearTimer, delay])

  const onBadgeLeave = useCallback(() => {
    clearTimer()
    timerRef.current = setTimeout(() => setVisible(false), 120)
  }, [clearTimer])

  const onPopoverEnter = useCallback(() => {
    clearTimer()
  }, [clearTimer])

  const onPopoverLeave = useCallback(() => {
    clearTimer()
    timerRef.current = setTimeout(() => setVisible(false), 80)
  }, [clearTimer])

  // Dismiss on scroll to prevent stale positioning
  useEffect(() => {
    if (!visible) return
    // Find the nearest scrollable ancestor (Virtuoso scroller or plain scroller)
    let el = badgeRef.current?.parentElement ?? null
    while (el) {
      const { overflowY } = getComputedStyle(el)
      if (overflowY === 'auto' || overflowY === 'scroll') break
      el = el.parentElement
    }
    if (!el) return
    el.addEventListener('scroll', dismiss, { passive: true })
    return () => el.removeEventListener('scroll', dismiss)
  }, [visible, dismiss])

  // Cleanup pending timers on unmount
  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [])

  return { visible, anchorRect, badgeRef, onBadgeEnter, onBadgeLeave, onPopoverEnter, onPopoverLeave }
}
