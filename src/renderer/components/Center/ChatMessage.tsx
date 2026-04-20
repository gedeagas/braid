import { memo, useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { ContentBlock, Message, TurnUsage } from '@/types'
import { useUIStore } from '@/store/ui'
import { useSessionsStore } from '@/store/sessions'
import { flash } from '@/store/flash'
import { ToolCallGroup } from './ToolCallGroup'
import { StreamingMarkdown } from './StreamingMarkdown'
import { parseMentions } from './mentionHighlight'
import { ImageLightbox } from './ImageLightbox'
import { IconPrBranch, IconChevronRight, IconChevronDown, IconCodeBrackets, IconFile, IconCopy, IconCheckmark, IconTerminal, IconUndo } from '@/components/shared/icons'
import { TurnFooter } from './TurnFooter'
import { Dialog, Button } from '@/components/ui'
import { parseDiffComments, parseSnippets, parseTerminalBlocks, stripAttachmentBlocks } from './diffCommentUtils'
import type { ParsedDiffComment, ParsedSnippet, ParsedTerminalBlock } from './diffCommentUtils'
import { formatTokens } from '@/lib/constants'

/** Renders text with @mentions highlighted as accent-coloured spans */
function renderWithMentions(text: string): React.ReactNode {
  const parts = parseMentions(text, 'chat-msg-mention')
  return parts.length > 0 ? parts : text
}

function useCopyToClipboard(text: string) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => clearTimeout(timerRef.current), [])

  const handleCopy = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard.writeText(text)
    setCopied(true)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setCopied(false), 2000)
  }, [text])

  return { copied, handleCopy }
}

function AssistantCopyButton({ text }: { text: string }) {
  const { t } = useTranslation('common')
  const { copied, handleCopy } = useCopyToClipboard(text)

  return (
    <button
      className={`chat-msg-copy-btn${copied ? ' chat-msg-copy-btn--copied' : ''}`}
      onClick={handleCopy}
      title={copied ? t('copied') : t('copy')}
    >
      {copied ? <IconCheckmark size={14} /> : <IconCopy size={14} />}
    </button>
  )
}

/** Rewind-to-here button shown below user messages when the experimental flag is enabled. */
function RollbackButton({ messageId }: { messageId: string }) {
  const { t } = useTranslation('center')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const sessionId = useSessionsStore((s) => s.activeSessionId)
  const sessionStatus = useSessionsStore((s) => sessionId ? s.sessions[sessionId]?.status : undefined)
  const rollbackToUserMessage = useSessionsStore((s) => s.rollbackToUserMessage)

  const canRollback =
    !!sessionId &&
    (sessionStatus === 'idle' || sessionStatus === 'error' || sessionStatus === 'inactive')

  const handleClick = useCallback(() => {
    if (!canRollback) return
    setOpen(true)
  }, [canRollback])

  const handleConfirm = useCallback(async () => {
    if (!sessionId) return
    setBusy(true)
    try {
      await rollbackToUserMessage(sessionId, messageId)
    } catch (err) {
      console.error('[Braid] rollbackToUserMessage failed:', err)
      const msg = err instanceof Error ? err.message : 'Rollback failed'
      flash('error', msg.includes('SNAPSHOT_NOT_FOUND') ? 'Snapshot expired - git may have garbage-collected it' : msg)
    } finally {
      setBusy(false)
      setOpen(false)
    }
  }, [sessionId, messageId, rollbackToUserMessage])

  return (
    <>
      <div className="turn-actions">
        <button
          className={`turn-actions-btn${!canRollback ? ' turn-actions-btn--disabled' : ''}`}
          onClick={handleClick}
          title={canRollback ? t('rollback.button') : t('rollback.disabledBusy')}
          disabled={!canRollback}
          aria-label={t('rollback.button')}
        >
          <IconUndo size={14} />
        </button>
      </div>
      {createPortal(
        <Dialog
          isOpen={open}
          onClose={() => { if (!busy) setOpen(false) }}
          title={t('rollback.confirmTitle')}
          actions={
            <>
              <Button onClick={() => setOpen(false)} disabled={busy}>
                {t('rollback.cancel')}
              </Button>
              <Button variant="danger" onClick={handleConfirm} loading={busy}>
                {t('rollback.confirm')}
              </Button>
            </>
          }
        >
          <p>{t('rollback.confirmBody')}</p>
        </Dialog>,
        document.body
      )}
    </>
  )
}

interface TurnActionsProps {
  text: string
  durationMs?: number
  turnUsage?: TurnUsage
}

function TurnActions({ text, durationMs, turnUsage }: TurnActionsProps) {
  const { t } = useTranslation('common')
  const { copied, handleCopy } = useCopyToClipboard(text)

  return (
    <div className="turn-actions">
      {durationMs != null && durationMs > 0 && (
        <TurnDuration durationMs={durationMs} turnUsage={turnUsage} />
      )}
      <button
        className={`turn-actions-btn${copied ? ' turn-actions-btn--copied' : ''}`}
        onClick={handleCopy}
        title={copied ? t('copied') : t('copy')}
      >
        {copied ? <IconCheckmark size={14} /> : <IconCopy size={14} />}
      </button>
    </div>
  )
}

const MODEL_LABELS: Record<string, string> = {
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'claude-opus-4-6': 'Opus 4.6',
  'claude-haiku-4-5': 'Haiku 4.5'
}

function formatModelName(raw?: string): string | null {
  if (!raw) return null
  if (MODEL_LABELS[raw]) return MODEL_LABELS[raw]
  for (const [prefix, label] of Object.entries(MODEL_LABELS)) {
    if (raw.startsWith(prefix)) return label
  }
  return raw
}

/** Duration text with a portal-based hover tooltip that escapes overflow:hidden ancestors. */
function TurnDuration({ durationMs, turnUsage }: { durationMs: number; turnUsage?: TurnUsage }) {
  const { t } = useTranslation('center')
  const [hovered, setHovered] = useState(false)
  const anchorRef = useRef<HTMLSpanElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 })

  useLayoutEffect(() => {
    if (!hovered || !anchorRef.current || !tooltipRef.current) return
    const r = anchorRef.current.getBoundingClientRect()
    const tt = tooltipRef.current.getBoundingClientRect()
    // Position above the anchor, left-aligned
    let top = r.top - tt.height - 6
    // If it would overflow the top of the viewport, flip below
    if (top < 4) top = r.bottom + 6
    // Clamp left to keep tooltip within viewport
    const left = Math.max(4, Math.min(r.left, window.innerWidth - tt.width - 4))
    setCoords({ top, left })
  }, [hovered])

  const modelName = turnUsage ? formatModelName(turnUsage.model) : null

  return (
    <span
      ref={anchorRef}
      className="turn-actions-duration"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {formatDuration(durationMs)}
      {hovered && turnUsage && createPortal(
        <div
          ref={tooltipRef}
          className="turn-usage-tooltip"
          style={{ top: coords.top, left: coords.left }}
        >
          {modelName && (
            <div className="turn-usage-tooltip-row">
              <span className="turn-usage-tooltip-label">{t('turnStats.model')}</span>
              <span className="turn-usage-tooltip-value">{modelName}</span>
            </div>
          )}
          <div className="turn-usage-tooltip-row">
            <span className="turn-usage-tooltip-label">{t('turnStats.duration')}</span>
            <span className="turn-usage-tooltip-value">{formatDuration(durationMs)}</span>
          </div>
          <div className="turn-usage-tooltip-row">
            <span className="turn-usage-tooltip-label">{t('turnStats.input')}</span>
            <span className="turn-usage-tooltip-value">{formatTokens(turnUsage.inputTokens)}</span>
          </div>
          <div className="turn-usage-tooltip-row">
            <span className="turn-usage-tooltip-label">{t('turnStats.output')}</span>
            <span className="turn-usage-tooltip-value">{formatTokens(turnUsage.outputTokens)}</span>
          </div>
          {turnUsage.cacheReadTokens > 0 && (
            <div className="turn-usage-tooltip-row">
              <span className="turn-usage-tooltip-label">{t('turnStats.cacheRead')}</span>
              <span className="turn-usage-tooltip-value">{formatTokens(turnUsage.cacheReadTokens)}</span>
            </div>
          )}
          {turnUsage.cacheWriteTokens > 0 && (
            <div className="turn-usage-tooltip-row">
              <span className="turn-usage-tooltip-label">{t('turnStats.cacheWrite')}</span>
              <span className="turn-usage-tooltip-value">{formatTokens(turnUsage.cacheWriteTokens)}</span>
            </div>
          )}
        </div>,
        document.body
      )}
    </span>
  )
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 10000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 60000) return `${Math.round(ms / 1000)}s`
  const mins = Math.floor(ms / 60000)
  const secs = Math.round((ms % 60000) / 1000)
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`
}

interface Props {
  message: Message
}

export const ChatMessage = memo(function ChatMessage({ message }: Props) {
  const { t } = useTranslation('center')
  const streamingAnimation = useUIStore((s) => s.streamingAnimation)
  const rollbackHistoryEnabled = useUIStore((s) => s.rollbackHistory)
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)
  const closeLightbox = useCallback(() => setLightboxSrc(null), [])

  if (message.role === 'system' && message.tag === 'compact-boundary') {
    return (
      <div className="chat-msg chat-msg-compact-boundary">
        <span className="chat-msg-compact-boundary-label">{message.content}</span>
      </div>
    )
  }

  if (message.role === 'system') {
    return (
      <div className="chat-msg chat-msg-system">
        <div className="chat-msg-system-content">{message.content}</div>
      </div>
    )
  }

  if (message.role === 'user' && message.tag === 'create-pr') {
    return <CreatePrCard content={message.content} />
  }

  if (message.role === 'user') {
    // Extract snippet, diff comment, and terminal attachments
    const snippets = parseSnippets(message.content)
    const diffComments = parseDiffComments(message.content)
    const terminalBlocks = parseTerminalBlocks(message.content)

    // Strip attachment blocks so the bubble only shows human-readable text.
    const displayContent = stripAttachmentBlocks(message.content)

    const showRollback = rollbackHistoryEnabled && !!message.snapshotSha

    return (
      <div className="chat-msg chat-msg-user">
        {message.images && message.images.length > 0 && (
          <div className="chat-msg-user-images">
            {message.images.map((uri, i) => (
              <img
                key={i}
                src={uri}
                alt={`Attached image ${i + 1}`}
                className="chat-msg-user-image"
                onClick={() => setLightboxSrc(uri)}
              />
            ))}
          </div>
        )}
        {diffComments.length > 0 && <SentDiffComments comments={diffComments} />}
        {terminalBlocks.length > 0 && <SentTerminalOutput blocks={terminalBlocks} />}
        {snippets.length > 0 && <SentSnippets snippets={snippets} />}
        {displayContent && (
          <div className="chat-msg-user-bubble">{renderWithMentions(displayContent)}</div>
        )}
        {showRollback && <RollbackButton messageId={message.id} />}
        {lightboxSrc && (
          <ImageLightbox src={lightboxSrc} alt="Image preview" onClose={closeLightbox} />
        )}
      </div>
    )
  }

  // Assistant message — use blocks if available for interleaved rendering
  const blocks = message.blocks
  const hasToolCalls = blocks
    ? blocks.some((b) => b.type === 'tool_use')
    : (message.toolCalls && message.toolCalls.length > 0)

  if (hasToolCalls && blocks && blocks.length > 0) {
    // Split blocks: everything up to (and including) the last tool_use goes in the group,
    // trailing text goes outside
    const lastToolIdx = findLastToolIndex(blocks)
    const groupBlocks = blocks.slice(0, lastToolIdx + 1)
    const trailingBlocks = blocks.slice(lastToolIdx + 1)
    const trailingText = joinTextBlocks(trailingBlocks)
    const allText = joinTextBlocks(blocks)

    return (
      <div className="chat-msg chat-msg-assistant">
        <ToolCallGroup blocks={groupBlocks} isPartial={message.isPartial} />
        {trailingText && (
          <div className="chat-msg-assistant-content chat-msg-content-wrapper">
            <StreamingMarkdown content={trailingText} isStreaming={message.isPartial} enableAnimation={streamingAnimation} />
            {!message.isPartial && <AssistantCopyButton text={trailingText} />}
          </div>
        )}
        {!message.isPartial && <TurnFooter blocks={groupBlocks} />}
        {!message.isPartial && allText && (
          <TurnActions text={allText} durationMs={message.turnDurationMs} turnUsage={message.turnUsage} />
        )}
      </div>
    )
  }

  // No tool calls — render content directly
  return (
    <div className="chat-msg chat-msg-assistant">
      {message.content && (
        <div className="chat-msg-assistant-content chat-msg-content-wrapper">
          <StreamingMarkdown content={message.content} isStreaming={message.isPartial} enableAnimation={streamingAnimation} />
          {!message.isPartial && <AssistantCopyButton text={message.content} />}
        </div>
      )}
      {!message.isPartial && message.content && (
        <TurnActions text={message.content} durationMs={message.turnDurationMs} turnUsage={message.turnUsage} />
      )}
    </div>
  )
})

export function SentSnippets({ snippets }: { snippets: ParsedSnippet[] }) {
  const { t } = useTranslation('center')
  const [expandedSet, setExpandedSet] = useState<Set<number>>(new Set())

  const toggle = useCallback((idx: number) => {
    setExpandedSet((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }, [])

  return (
    <div className="chat-msg-snippets">
      {snippets.map((snippet, i) => {
        const expanded = expandedSet.has(i)
        return (
          <div key={i} className="chat-msg-snippet-card">
            <button
              className="chat-msg-snippet-card-header"
              onClick={() => toggle(i)}
              title={expanded ? t('snippetCollapse') : t('snippetExpand')}
            >
              {expanded ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
              <IconCodeBrackets size={13} style={{ flexShrink: 0, opacity: 0.6 }} />
              <span className="chat-msg-snippet-card-preview">{snippet.firstLine}</span>
              <span className="chat-msg-snippet-card-badge">
                {snippet.lines} {t('snippetLines')}
              </span>
            </button>
            {expanded && (
              <pre className="chat-msg-snippet-card-content">{snippet.content}</pre>
            )}
          </div>
        )
      })}
    </div>
  )
}

/* ---- Terminal output cards in sent user messages ---- */

const ICON_STYLE_TERMINAL = { flexShrink: 0, opacity: 0.6 } as const

export function SentTerminalOutput({ blocks }: { blocks: ParsedTerminalBlock[] }) {
  const { t } = useTranslation('center')
  const [expandedSet, setExpandedSet] = useState<Set<number>>(new Set())

  const toggle = useCallback((idx: number) => {
    setExpandedSet((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }, [])

  return (
    <div className="chat-msg-terminal-blocks">
      {blocks.map((block, i) => {
        const expanded = expandedSet.has(i)
        const badge = block.terminalCount > 1
          ? `${block.terminalCount} ${t('terminalTabs')}`
          : `${block.lineCount} ${t('terminalLines')}`
        return (
          <div key={i} className="chat-msg-terminal-card">
            <button
              className="chat-msg-terminal-card-header"
              onClick={() => toggle(i)}
              title={expanded ? t('terminalCollapse') : t('terminalExpand')}
            >
              {expanded ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
              <IconTerminal size={13} style={ICON_STYLE_TERMINAL} />
              <span className="chat-msg-terminal-card-preview">{block.firstLine}</span>
              <span className="chat-msg-terminal-card-badge">{badge}</span>
            </button>
            {expanded && (
              <pre className="chat-msg-terminal-card-content">{block.content}</pre>
            )}
          </div>
        )
      })}
    </div>
  )
}

/* ---- Diff comment cards in sent user messages ---- */

const LINE_TYPE_SYMBOL: Record<string, string> = { add: '+', del: '-', ctx: ' ' }
const ICON_STYLE_MUTED = { flexShrink: 0, opacity: 0.5 } as const

export function SentDiffComments({ comments }: { comments: ParsedDiffComment[] }) {
  return (
    <div className="chat-msg-diff-comments">
      {comments.map((c, i) => {
        const symbol = LINE_TYPE_SYMBOL[c.lineType] || ' '
        const typeClass = `chat-msg-dc-code--${c.lineType}`
        return (
          <div key={i} className="chat-msg-dc-card">
            <div className="chat-msg-dc-header">
              <IconFile size={12} style={ICON_STYLE_MUTED} />
              <span className="chat-msg-dc-file">{c.file}</span>
              <span className="chat-msg-dc-lines">L{c.lines}</span>
            </div>
            <div className={`chat-msg-dc-code ${typeClass}`}>
              {c.code.map((line, j) => (
                <div key={j} className="chat-msg-dc-code-line">
                  <span className="chat-msg-dc-code-symbol">{symbol}</span>
                  <span>{line}</span>
                </div>
              ))}
            </div>
            <div className="chat-msg-dc-comment">{c.comment}</div>
          </div>
        )
      })}
    </div>
  )
}

function CreatePrCard({ content }: { content: string }) {
  const { t } = useTranslation('center')
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="chat-msg chat-msg-user">
      <button
        className="chat-pr-card"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-label={t('createPrLabel')}
      >
        <span className="chat-pr-card-icon"><IconPrBranch size={16} /></span>
        <span className="chat-pr-card-label">{t('createPrLabel')}</span>
        <span className="chat-pr-card-toggle">
          {expanded ? t('createPrHidePrompt') : t('createPrViewPrompt')}
        </span>
        <span className="chat-pr-card-chevron">
          {expanded ? <IconChevronDown /> : <IconChevronRight />}
        </span>
      </button>
      {expanded && (
        <pre className="chat-pr-card-prompt">{content}</pre>
      )}
    </div>
  )
}

function findLastToolIndex(blocks: ContentBlock[]): number {
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].type === 'tool_use') return i
  }
  return -1
}

function joinTextBlocks(blocks: ContentBlock[]): string {
  return blocks
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('')
}
