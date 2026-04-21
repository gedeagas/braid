import React from 'react'
import { openExternalLink } from '@/lib/openExternalLink'

/** Combined regex: @mentions (groups 1-2) and URLs (group 3) in a single pass */
const MENTION_OR_URL_RE = /(?:(^|\s)(@\S+))|(https?:\/\/[^\s)>\]]+)/g

/**
 * Parses text and returns React nodes with @mentions wrapped in highlighted spans
 * and URLs rendered as clickable links that open in the default browser.
 * Used by both the input backdrop overlay and sent message bubbles.
 */
export function parseMentions(
  text: string,
  className: string,
  Tag: 'mark' | 'span' = 'span'
): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  MENTION_OR_URL_RE.lastIndex = 0
  while ((match = MENTION_OR_URL_RE.exec(text)) !== null) {
    const start = match.index

    if (match[2]) {
      // @mention match
      const prefix = match[1]
      const mention = match[2]
      if (start + prefix.length > lastIndex) {
        parts.push(text.slice(lastIndex, start + prefix.length))
      }
      parts.push(<Tag key={`m${start}`} className={className}>{mention}</Tag>)
    } else if (match[3]) {
      // URL match
      const url = match[3]
      if (start > lastIndex) {
        parts.push(text.slice(lastIndex, start))
      }
      parts.push(
        <a
          key={`u${start}`}
          href={url}
          className="chat-msg-inline-link"
          onClick={(e) => openExternalLink(e, url)}
        >
          {url}
        </a>
      )
    }
    lastIndex = start + match[0].length
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts
}

/** Renders a backdrop div mirroring the textarea content with @mentions highlighted */
export function InputHighlightBackdrop({ text }: { text: string }) {
  const parts = parseMentions(text, 'chat-input-mention-hl', 'mark')
  // Trailing newline ensures the backdrop's height matches the textarea when text ends with \n
  parts.push('\n')

  return (
    <div className="chat-input-backdrop">
      {parts}
    </div>
  )
}
