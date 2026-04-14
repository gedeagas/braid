// ---------------------------------------------------------------------------
// Memoized markdown block renderer.
// Each top-level markdown block (paragraph, code fence, list, etc.) is
// wrapped in React.memo so it skips re-render when its content is unchanged.
// During streaming, only the last (active) block re-renders.
// Ported from Streamdown's Block component.
// ---------------------------------------------------------------------------

import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import type { PluggableList } from 'unified'
import { BlockIncompleteContext } from '@/lib/BlockIncompleteContext'

interface MemoizedBlockProps {
  content: string
  index: number
  isIncomplete: boolean
  components: Record<string, React.ComponentType<any>>
  remarkPlugins: PluggableList
  rehypePlugins: PluggableList
}

export const MemoizedBlock = memo(
  function MemoizedBlock({
    content,
    isIncomplete,
    components,
    remarkPlugins,
    rehypePlugins,
  }: MemoizedBlockProps) {
    return (
      <BlockIncompleteContext.Provider value={isIncomplete}>
        <ReactMarkdown
          remarkPlugins={remarkPlugins}
          rehypePlugins={rehypePlugins}
          components={components}
        >
          {content}
        </ReactMarkdown>
      </BlockIncompleteContext.Provider>
    )
  },
  (prev, next) => {
    if (prev.content !== next.content) return false
    if (prev.index !== next.index) return false
    if (prev.isIncomplete !== next.isIncomplete) return false
    if (prev.rehypePlugins !== next.rehypePlugins) return false
    if (prev.remarkPlugins !== next.remarkPlugins) return false

    // Shallow compare components object
    if (prev.components !== next.components) {
      const prevKeys = Object.keys(prev.components)
      const nextKeys = Object.keys(next.components)
      if (prevKeys.length !== nextKeys.length) return false
      if (prevKeys.some((k) => prev.components[k] !== next.components[k])) return false
    }

    return true
  },
)

MemoizedBlock.displayName = 'MemoizedBlock'
