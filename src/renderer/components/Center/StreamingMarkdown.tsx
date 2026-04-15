// ---------------------------------------------------------------------------
// Block-level memoized markdown renderer for streaming AI responses.
//
// Splits markdown into top-level blocks using `marked`'s Lexer, renders
// each block with a React.memo'd component. During streaming, only the
// last (active) block re-renders - all completed blocks skip entirely.
//
// Blocks are rendered synchronously from the latest useMemo parse -
// no deferred state or useTransition, which avoids stale-block races
// where shifted block boundaries cause words to appear out of order.
//
// Inspired by the Streamdown architecture.
// ---------------------------------------------------------------------------

import { useId, useLayoutEffect, useMemo, useRef } from 'react'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import type { PluggableList } from 'unified'
import { parseMarkdownBlocks } from '@/lib/parseMarkdownBlocks'
import { hasIncompleteCodeFence } from '@/lib/incompleteCodeUtils'
import { remend } from '@/lib/remend'
import { createAnimatePlugin, type AnimatePlugin } from '@/lib/rehypeAnimate'
import { markdownComponents as defaultMdComponents } from './ToolCallGroup/toolMeta'
import { MemoizedBlock } from './MemoizedBlock'

interface StreamingMarkdownProps {
  /** The full markdown content (may be growing during streaming) */
  content: string
  /** Whether this content is actively streaming */
  isStreaming?: boolean
  /** Custom ReactMarkdown component overrides */
  components?: Record<string, React.ComponentType<any>>
  /** Include rehype-highlight for code syntax coloring (default true) */
  enableHighlight?: boolean
  /** Enable word-by-word streaming animation (default true when streaming) */
  enableAnimation?: boolean
}

// Stable plugin arrays created once at module level
const defaultRemarkPlugins: PluggableList = [remarkGfm]
// highlight.js doesn't register tsx/jsx as built-in languages.
// Alias them to their base languages so code blocks render highlighted.
const highlightOptions = {
  aliases: {
    typescript: ['tsx', 'mts', 'cts'],
    javascript: ['jsx', 'mjs', 'cjs'],
  },
}
const defaultRehypePluginsWithHighlight: PluggableList = [[rehypeHighlight, highlightOptions]]
const defaultRehypePluginsNoHighlight: PluggableList = []

/**
 * Block-level memoized markdown renderer.
 *
 * Performance: during streaming, only the active (last) block re-renders.
 * All completed blocks are stable and memoized. This reduces the O(n^2)
 * full re-parse problem in react-markdown to O(block_size) per flush.
 */
export function StreamingMarkdown({
  content,
  isStreaming = false,
  components,
  enableHighlight = true,
  enableAnimation = true,
}: StreamingMarkdownProps) {
  const generatedId = useId()

  // Merge custom components with defaults (stable reference when unchanged)
  const mergedComponents = useMemo(
    () => (components ? { ...defaultMdComponents, ...components } : defaultMdComponents),
    [components],
  )

  // Repair incomplete markdown before parsing (only during streaming)
  const processedContent = useMemo(
    () => (isStreaming ? remend(content) : content),
    [content, isStreaming],
  )

  // Parse into top-level blocks — used directly (no deferred state)
  const blocks = useMemo(
    () => parseMarkdownBlocks(processedContent),
    [processedContent],
  )

  // Animate plugin instance (stable across renders, created once)
  const animatePluginRef = useRef<AnimatePlugin | null>(null)
  const prevCharCountRef = useRef(0)

  let pluginJustCreated = false
  if (enableAnimation && !animatePluginRef.current) {
    animatePluginRef.current = createAnimatePlugin({ animation: 'fadeIn', duration: 120, stagger: 30 })
    pluginJustCreated = true
  }
  const animatePlugin = enableAnimation ? animatePluginRef.current : null

  // When mounting into an active stream that already has content (e.g. switching
  // back from another tab), skip animating all the accumulated text. The first
  // useLayoutEffect will snapshot the real char count so only content arriving
  // after this render animates.
  if (pluginJustCreated && isStreaming && content.length > 0) {
    prevCharCountRef.current = Infinity
  }

  // After DOM mutations (but before paint), snapshot the char count from
  // the animate plugin so the next render can skip already-visible words.
  useLayoutEffect(() => {
    if (animatePlugin && isStreaming) {
      prevCharCountRef.current = animatePlugin.getLastRenderCharCount()
    }
  })

  // Reset char count tracking when streaming ends so a fresh stream starts clean
  useLayoutEffect(() => {
    if (!isStreaming) {
      prevCharCountRef.current = 0
    }
  }, [isStreaming])

  // Generate stable keys (index-based, not content-based, per Streamdown)
  const blockKeys = useMemo(
    () => blocks.map((_b, idx) => `${generatedId}-${idx}`),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [blocks.length, generatedId],
  )

  // Build rehype plugins array (stable reference when config unchanged)
  const rehypePlugins = useMemo(() => {
    const base = enableHighlight ? defaultRehypePluginsWithHighlight : defaultRehypePluginsNoHighlight
    if (animatePlugin && isStreaming) {
      return [...base, animatePlugin.rehypePlugin]
    }
    return base
  }, [enableHighlight, animatePlugin, isStreaming])

  return (
    <>
      {blocks.map((block, index) => {
        const isLastBlock = index === blocks.length - 1
        const isIncomplete = isStreaming && isLastBlock && hasIncompleteCodeFence(block)

        // Tell the animate plugin how many chars were already rendered.
        // Uses the ref (non-destructive) instead of getLastRenderCharCount()
        // to avoid corruption from React strict-mode double renders.
        if (animatePlugin && isStreaming && isLastBlock) {
          animatePlugin.setPrevContentLength(prevCharCountRef.current)
        }

        return (
          <MemoizedBlock
            key={blockKeys[index]}
            content={block}
            index={index}
            isIncomplete={isIncomplete}
            components={mergedComponents}
            remarkPlugins={defaultRemarkPlugins}
            rehypePlugins={rehypePlugins}
          />
        )
      })}
    </>
  )
}
