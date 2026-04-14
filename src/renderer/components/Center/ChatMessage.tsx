import { memo, useState, useCallback, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { ContentBlock, Message } from '@/types'
import { useUIStore } from '@/store/ui'
import { ToolCallGroup } from './ToolCallGroup'
import { StreamingMarkdown } from './StreamingMarkdown'
import { parseMentions } from './mentionHighlight'
import { ImageLightbox } from './ImageLightbox'
import { IconPrBranch, IconChevronRight, IconChevronDown, IconCodeBrackets, IconFile, IconCopy, IconCheckmark, IconTerminal } from '@/components/shared/icons'
import { TurnFooter } from './TurnFooter'
import { parseDiffComments, parseSnippets, parseTerminalBlocks, stripAttachmentBlocks } from './diffCommentUtils'
import type { ParsedDiffComment, ParsedSnippet, ParsedTerminalBlock } from './diffCommentUtils'

/** Renders text with @mentions highlighted as accent-coloured spans */
function renderWithMentions(text: string): React.ReactNode {
  const parts = parseMentions(text, 'chat-msg-mention')
  return parts.length > 0 ? parts : text
}

function AssistantCopyButton({ text }: { text: string }) {
  const { t } = useTranslation('common')
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

interface Props {
  message: Message
}

export const ChatMessage = memo(function ChatMessage({ message }: Props) {
  const { t } = useTranslation('center')
  const streamingAnimation = useUIStore((s) => s.streamingAnimation)
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
    const trailingText = trailingBlocks
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('')

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
