import { useState, useCallback, useRef } from 'react'
import i18n from '@/lib/i18n'
import type { ContentBlock } from '@/types'
import { useChatScrollDisengage } from '@/lib/chatScrollContext'
import { IconChevronRight, IconChevronDown } from '@/components/shared/icons'
import { StreamingMarkdown } from '../StreamingMarkdown'
import { TOOL_SUMMARY_GROUPS } from './toolMeta'
import { ToolCallRow } from './ToolCallRow'

interface Props {
  blocks: ContentBlock[]
  isPartial?: boolean
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 10000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms / 1000)}s`
}

/** Compute wall-clock elapsed for a group: min(startedAt) → max(completedAt) */
function computeGroupElapsed(blocks: ContentBlock[]): number | null {
  let minStart = Infinity
  let maxEnd = 0
  let hasTimings = false
  for (const b of blocks) {
    if (b.type !== 'tool_use') continue
    const tc = b.toolCall
    if (tc.startedAt != null) {
      hasTimings = true
      if (tc.startedAt < minStart) minStart = tc.startedAt
    }
    if (tc.completedAt != null) {
      if (tc.completedAt > maxEnd) maxEnd = tc.completedAt
    }
  }
  if (!hasTimings || maxEnd === 0) return null
  return maxEnd - minStart
}

function buildSummaryLabel(blocks: ContentBlock[], textCount: number): string {
  const counts = new Map<string, number>()
  for (const b of blocks) {
    if (b.type !== 'tool_use') continue
    const group = TOOL_SUMMARY_GROUPS[b.toolCall.name] ?? b.toolCall.name.toLowerCase()
    counts.set(group, (counts.get(group) ?? 0) + 1)
  }

  const parts: string[] = []
  for (const [group, count] of counts) {
    parts.push(i18n.t(`toolSummary.${group}`, { count, ns: 'center', defaultValue: `${count} ${group}` }))
  }
  if (textCount > 0) {
    parts.push(i18n.t('toolMessage', { count: textCount, ns: 'center' }))
  }
  return parts.join(' \u00B7 ')
}

function findLastToolUseIndex(blocks: ContentBlock[]): number {
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].type === 'tool_use') return i
  }
  return -1
}

export function ToolCallGroup({ blocks, isPartial }: Props) {
  const hasError = blocks.some((b) => b.type === 'tool_use' && b.toolCall.error)
  const [expanded, setExpanded] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const disengageScroll = useChatScrollDisengage()

  const textCount = blocks.filter((b) => b.type === 'text' && b.text.trim()).length
  const label = buildSummaryLabel(blocks, textCount)
  const groupElapsed = computeGroupElapsed(blocks)

  const headerClass = `tcg-header${hasError ? ' tcg-header--error' : ''}`

  const handleHeaderKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' && expanded) {
      e.preventDefault()
      const first = bodyRef.current?.querySelector<HTMLElement>('.tcg-row-main')
      first?.focus()
    }
  }, [expanded])

  const handleHeaderClick = useCallback(() => {
    const next = !expanded
    // Stop the rAF auto-scroll loop before the body renders — otherwise the
    // loop immediately fires scrollTop = scrollHeight, scrolling the header
    // out of view and making the group appear to snap closed.
    if (next) disengageScroll()
    setExpanded(next)
  }, [expanded, disengageScroll])

  return (
    <div className="tcg">
      <button
        className={headerClass}
        onClick={handleHeaderClick}
        onKeyDown={handleHeaderKeyDown}
        aria-expanded={expanded}
      >
        <span className={`tcg-chevron ${expanded ? 'open' : ''}`}>{expanded ? <IconChevronDown /> : <IconChevronRight />}</span>
        <span className="tcg-label">{label}</span>
        {groupElapsed != null && (
          <span className="tcg-header-elapsed">{formatElapsed(groupElapsed)}</span>
        )}
        {hasError && <span className="tcg-header-error-dot" />}
      </button>

      {expanded && (
        <div className="tcg-body" ref={bodyRef} role="group">
          {blocks.map((block, i) => {
            if (block.type === 'tool_use') {
              const isLastTool = isPartial && i === findLastToolUseIndex(blocks)
              return (
                <ToolCallRow
                  key={block.toolCall.id}
                  toolCall={block.toolCall}
                  isInFlight={isLastTool}
                  defaultOpen={!!block.toolCall.error}
                />
              )
            }
            return (
              <div key={`text-${i}`} className="tcg-text">
                <StreamingMarkdown content={block.text} enableAnimation={false} />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
