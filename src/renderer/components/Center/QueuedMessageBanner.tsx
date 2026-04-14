/**
 * QueuedMessageBanner — renders the "queued next message" banner below the chat input.
 *
 * Shows the queued message preview with edit/discard actions.
 * Extracted from ChatInput.tsx to keep each file under the 450-line limit.
 */
import { useLayoutEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Tooltip } from '@/components/shared/Tooltip'
import { parseDiffComments, parseSnippets, parseTerminalBlocks, stripAttachmentBlocks } from './diffCommentUtils'
import { SentDiffComments, SentSnippets, SentTerminalOutput } from './ChatMessage'
import type { ChatViewAction } from './ChatView'

interface QueuedMessageBannerProps {
  queuedMessage: { text: string; images?: string[] }
  editingQueue: boolean
  queueEditValue: string
  queueEditRef: React.RefObject<HTMLTextAreaElement | null>
  dispatch: React.Dispatch<ChatViewAction>
  onStartEdit: () => void
  onCommitEdit: () => void
  onCancelEdit: () => void
  onDiscard: () => void
}

export function QueuedMessageBanner({
  queuedMessage, editingQueue, queueEditValue,
  queueEditRef, dispatch, onStartEdit, onCommitEdit, onCancelEdit, onDiscard,
}: QueuedMessageBannerProps) {
  const { t } = useTranslation('center')

  const startEditQueue = useCallback(() => {
    dispatch({ type: 'START_EDIT_QUEUE', text: queuedMessage.text })
    onStartEdit()
  }, [queuedMessage.text, dispatch, onStartEdit])

  // Auto-focus queue edit textarea
  useLayoutEffect(() => {
    if (editingQueue && queueEditRef.current) {
      queueEditRef.current.focus()
      const len = queueEditRef.current.value.length
      queueEditRef.current.setSelectionRange(len, len)
    }
  }, [editingQueue, queueEditRef])

  return (
    <div className="chat-queue-banner">
      <div className="chat-queue-header">
        <Tooltip content={t('queuedTooltip')} position="bottom">
          <span className="chat-queue-label">
            <span className="chat-queue-dot" />
            {t('queued')}
          </span>
        </Tooltip>
        <div className="chat-queue-actions">
          {!editingQueue && (
            <button className="chat-queue-btn" onClick={startEditQueue}>{t('editQueue')}</button>
          )}
          <button className="chat-queue-btn chat-queue-btn--cancel" onClick={onDiscard}>
            {t('discardQueue')}
          </button>
        </div>
      </div>
      {queuedMessage.images && queuedMessage.images.length > 0 && (
        <div className="chat-queue-images">
          {queuedMessage.images.map((uri, i) => (
            <div key={i} className="chat-queue-image">
              <img src={uri} alt={`Queued image ${i + 1}`} />
            </div>
          ))}
        </div>
      )}
      {editingQueue ? (
        <div className="chat-queue-edit">
          <textarea
            ref={queueEditRef}
            className="chat-queue-edit-input"
            value={queueEditValue}
            onChange={(e) => dispatch({ type: 'SET_QUEUE_EDIT_VALUE', value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onCommitEdit() }
              if (e.key === 'Escape') onCancelEdit()
            }}
            rows={2}
          />
          <div className="chat-queue-edit-actions">
            <button className="chat-queue-save-btn" onClick={onCommitEdit}>{t('queueSave')}</button>
            <button className="chat-queue-cancel-btn" onClick={onCancelEdit}>{t('queueCancel')}</button>
          </div>
        </div>
      ) : (
        <QueuePreview text={queuedMessage.text} onDoubleClick={startEditQueue} />
      )}
    </div>
  )
}

/** Renders queued message preview, parsing diff comments and snippets into styled cards. */
function QueuePreview({ text, onDoubleClick }: { text: string; onDoubleClick: () => void }) {
  const diffComments = useMemo(() => parseDiffComments(text), [text])
  const snippets = useMemo(() => parseSnippets(text), [text])
  const terminalBlocks = useMemo(() => parseTerminalBlocks(text), [text])
  const displayText = useMemo(() => stripAttachmentBlocks(text), [text])

  return (
    <div className="chat-queue-preview" onDoubleClick={onDoubleClick}>
      {diffComments.length > 0 && <SentDiffComments comments={diffComments} />}
      {terminalBlocks.length > 0 && <SentTerminalOutput blocks={terminalBlocks} />}
      {snippets.length > 0 && <SentSnippets snippets={snippets} />}
      {displayText && <span>{displayText}</span>}
    </div>
  )
}
