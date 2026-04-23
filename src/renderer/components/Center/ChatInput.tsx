/**
 * ChatInput — the full input panel below the message list.
 *
 * Handles: drag-and-drop, paste, image previews, file mention chips,
 * snippet chips, context warning, textarea, slash/mention autocomplete,
 * queued-message banner, and prompt overlays (ExitPlanMode, ToolPermission).
 *
 * Extracted from ChatView.tsx to keep each file under the 450-line limit.
 */
import { useRef, useEffect, useCallback, useMemo } from 'react'
import { useSessionsStore } from '@/store/sessions'
import { SlashAutocomplete, filterSlashCommands } from './SlashAutocomplete'
import { MentionAutocomplete } from './MentionAutocomplete'
import { InputHighlightBackdrop } from './mentionHighlight'
import { SnippetChips } from './SnippetChips'
import { LinkedWorktreeChips } from './LinkedWorktreeChips'
import { ExitPlanModePrompt } from './ExitPlanModePrompt'
import { ToolPermissionPrompt } from './ToolPermissionPrompt'
import { AuthErrorPrompt } from './AuthErrorPrompt'
import { ElicitationPrompt } from './ElicitationPrompt'
import type { AgentSession, SlashCommand, SnippetAttachment } from '@/types'
import { parseSnippets, stripAttachmentBlocks } from './diffCommentUtils'
import type { AttachedFile } from '@/types'
import { IconArrowDown, IconClose } from '@/components/shared/icons'
import { flash } from '@/store/flash'
import { useTranslation } from 'react-i18next'
import type { ChatViewAction, ChatViewState } from './ChatView'
import { TERMINAL_ENTRY, type UseMentionReturn } from './useMentionAutocomplete'
import { QueuedMessageBanner } from './QueuedMessageBanner'
import { getContextWindow } from '@/lib/constants'

// ─── Constants ─────────────────────────────────────────────────────────────────
export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
export const MAX_IMAGE_SIZE = 2 * 1024 * 1024
const MAX_SNIPPET_SIZE = 100_000
const MAX_SNIPPETS = 5
const SNIPPET_LINE_THRESHOLD = 10
const SNIPPET_CHAR_THRESHOLD = 500
const generateSnippetId = () => `snippet-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
const MAX_DRAFT_INPUT = 50_000
const CONTEXT_WARN_THRESHOLD = 0.75
const CONTEXT_CRITICAL_THRESHOLD = 0.90
export const MAX_IMAGES = 5

// ─── Props ─────────────────────────────────────────────────────────────────────

export type ChatInputVariant = 'default' | 'diff'

interface ChatInputProps {
  activeSession: AgentSession
  input: string
  snippets: SnippetAttachment[]
  slashCommands: SlashCommand[]
  mention: UseMentionReturn
  isRunning: boolean
  isWaitingInput: boolean
  state: ChatViewState
  dispatch: React.Dispatch<ChatViewAction>
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  queueEditRef: React.RefObject<HTMLTextAreaElement | null>
  onSend: () => void
  onAddImages: (files: File[]) => void
  /** 'diff' hides linked worktrees, context warning, and prompt overlays */
  variant?: ChatInputVariant
}

export function ChatInput({
  activeSession, input, snippets, slashCommands, mention,
  isRunning, isWaitingInput, state, dispatch, textareaRef, queueEditRef, onSend, onAddImages,
  variant = 'default',
}: ChatInputProps) {
  const { t } = useTranslation('center')
  const { attachedImages, isDragOver, showSlash, slashFilter, slashIndex, editingQueue, queueEditValue } = state

  const setDraftInput = useSessionsStore((s) => s.setDraftInput)
  const stopSession = useSessionsStore((s) => s.stopSession)
  const fetchSlashCommands = useSessionsStore((s) => s.fetchSlashCommands)
  const setQueuedMessage = useSessionsStore((s) => s.setQueuedMessage)
  const setEditingQueue = useSessionsStore((s) => s.setEditingQueue)
  const drainDeferredQueue = useSessionsStore((s) => s.drainDeferredQueue)
  const approvePlan = useSessionsStore((s) => s.approvePlan)
  const rejectPlan = useSessionsStore((s) => s.rejectPlan)
  const allowTool = useSessionsStore((s) => s.allowTool)
  const denyTool = useSessionsStore((s) => s.denyTool)
  const alwaysAllowTool = useSessionsStore((s) => s.alwaysAllowTool)
  const retryAfterAuth = useSessionsStore((s) => s.retryAfterAuth)
  const dismissAuthError = useSessionsStore((s) => s.dismissAuthError)
  const answerElicitation = useSessionsStore((s) => s.answerElicitation)
  const addDraftSnippet = useSessionsStore((s) => s.addDraftSnippet)
  const removeDraftSnippet = useSessionsStore((s) => s.removeDraftSnippet)
  const setDraftSnippets = useSessionsStore((s) => s.setDraftSnippets)

  const queuedMessage = useSessionsStore((s) => s.queuedMessages[activeSession.id] ?? null)

  const {
    handleInputChangeForMention, handleMentionKeyDown,
    buildPromptWithFiles, clearFiles: clearMentionFiles, attachedFiles: mentionFiles,
  } = mention

  // ─── Message history navigation ──────────────────────────────────────────
  const historyIndexRef = useRef(-1)                            // -1 = not browsing history
  const savedDraftRef = useRef('')                              // draft text saved before entering history
  const savedDraftSnippetsRef = useRef<SnippetAttachment[]>([]) // draft snippet chips saved before entering history
  const savedDraftImagesRef = useRef<string[]>([])              // draft attached images saved before entering history
  const lastEscapeRef = useRef(0)                               // timestamp of last Escape — for double-Esc detection

  const userMessages = useMemo(
    () => activeSession.messages
      .filter((m) => m.role === 'user')
      .map((m) => ({
        text: (m.content ?? '')
          .replace(/\[Image \d+\]:\s*/g, '')
          .replace(/data:[^;]+;base64,[A-Za-z0-9+/=]+/g, '')
          .trim(),
        images: m.images ?? [],
      }))
      .filter((m) => m.text || m.images.length > 0),
    [activeSession.messages]
  )

  // Reset history cursor and escape tracker when switching sessions
  useEffect(() => {
    historyIndexRef.current = -1
    savedDraftRef.current = ''
    savedDraftSnippetsRef.current = []
    savedDraftImagesRef.current = []
    lastEscapeRef.current = 0
  }, [activeSession.id])

  // ─── Auto-resize textarea + sync backdrop ────────────────────────────────
  useEffect(() => {
    const ta = textareaRef.current
    if (ta) {
      ta.style.height = 'auto'
      ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'
      const bd = ta.parentElement?.querySelector('.chat-input-backdrop') as HTMLElement | null
      if (bd) {
        bd.style.height = ta.style.height
        bd.scrollTop = ta.scrollTop
      }
    }
  }, [input, textareaRef])

  // ─── Drag & drop ─────────────────────────────────────────────────────────

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    if (e.dataTransfer.types.includes('Files')) dispatch({ type: 'SET_DRAG_OVER', value: true })
  }, [dispatch])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      dispatch({ type: 'SET_DRAG_OVER', value: false })
    }
  }, [dispatch])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    dispatch({ type: 'SET_DRAG_OVER', value: false })
    const files = Array.from(e.dataTransfer.files)
    const items = Array.from(e.dataTransfer.items)

    // Separate folders from regular files
    const folderPaths: string[] = []
    const nonFolderFiles: File[] = []
    for (let i = 0; i < files.length; i++) {
      const entry = items[i]?.webkitGetAsEntry?.()
      if (entry?.isDirectory) {
        const path = (files[i] as File & { path: string }).path
        if (path) folderPaths.push(path)
      } else {
        nonFolderFiles.push(files[i])
      }
    }

    if (folderPaths.length > 0) await mention.addFilesByPath(folderPaths)

    const imageFiles = nonFolderFiles.filter((f) => ACCEPTED_IMAGE_TYPES.includes(f.type))
    const textFiles = nonFolderFiles.filter((f) => !ACCEPTED_IMAGE_TYPES.includes(f.type))
    if (imageFiles.length > 0) await onAddImages(imageFiles)
    if (textFiles.length > 0) {
      let currentCount = snippets.length
      for (const file of textFiles) {
        if (currentCount >= MAX_SNIPPETS) { flash('warning', t('snippetLimitReached')); break }
        if (file.size > MAX_SNIPPET_SIZE) { flash('warning', t('snippetTooLarge')); continue }
        try {
          const text = await file.text()
          if (!text.trim()) continue
          const lines = text.split('\n')
          const firstLine = (lines.find((l) => l.trim()) ?? '').slice(0, 80)
          addDraftSnippet(activeSession.id, {
            id: generateSnippetId(),
            content: text,
            firstLine: file.name ? `${file.name}: ${firstLine}` : firstLine,
            lineCount: lines.length,
            charCount: text.length,
          })
          currentCount++
        } catch { /* binary or unreadable — skip */ }
      }
    }
  }, [onAddImages, activeSession.id, snippets.length, addDraftSnippet, dispatch, t, mention.addFilesByPath])

  // ─── Paste ─────────────────────────────────────────────────────────────────

  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text/plain')
    if (text && (text.length >= SNIPPET_CHAR_THRESHOLD || text.split('\n').length >= SNIPPET_LINE_THRESHOLD)) {
      e.preventDefault()
      if (text.length > MAX_SNIPPET_SIZE) { flash('warning', t('snippetTooLarge')); return }
      if (snippets.length >= MAX_SNIPPETS) { flash('warning', t('snippetLimitReached')); return }
      const lines = text.split('\n')
      const firstLine = (lines.find((l) => l.trim()) ?? '').slice(0, 80)
      addDraftSnippet(activeSession.id, {
        id: generateSnippetId(),
        content: text, firstLine, lineCount: lines.length, charCount: text.length,
      })
      return
    }
    const items = Array.from(e.clipboardData.items)
    const imageItems = items.filter((item) => ACCEPTED_IMAGE_TYPES.includes(item.type))
    if (imageItems.length === 0) return
    e.preventDefault()
    const files = imageItems.map((item) => item.getAsFile()).filter(Boolean) as File[]
    await onAddImages(files)
  }, [onAddImages, activeSession.id, snippets.length, addDraftSnippet, t])

  // ─── Input handling ───────────────────────────────────────────────────────

  const handleInputChange = useCallback((value: string) => {
    if (value.length > MAX_DRAFT_INPUT) { flash('warning', t('draftInputTooLarge')); return }
    historyIndexRef.current = -1
    setDraftInput(activeSession.id, value)
    if (value.startsWith('/') && !value.includes(' ')) {
      dispatch({ type: 'OPEN_SLASH', filter: value.slice(1) })
      if (!slashCommands || slashCommands.length === 0) fetchSlashCommands(activeSession.id)
    } else {
      dispatch({ type: 'CLOSE_SLASH' })
    }
    handleInputChangeForMention(value, textareaRef.current?.selectionStart ?? value.length)
  }, [activeSession.id, setDraftInput, slashCommands, fetchSlashCommands, handleInputChangeForMention, dispatch, textareaRef, t])

  const handleSlashSelect = useCallback((command: string) => {
    setDraftInput(activeSession.id, `/${command} `)
    dispatch({ type: 'CLOSE_SLASH' })
    textareaRef.current?.focus()
  }, [activeSession.id, setDraftInput, dispatch, textareaRef])

  const restoreEntry = useCallback((entry: { text: string; images: string[] }) => {
    // Re-inflate <snippet> blocks as chips so raw XML doesn't appear in the textarea.
    const chips = parseSnippets(entry.text).map((p) => ({
      id: generateSnippetId(),
      content: p.content,
      firstLine: p.firstLine.slice(0, 80),
      lineCount: p.lines,
      charCount: p.content.length,
    }))
    setDraftSnippets(activeSession.id, chips)
    setDraftInput(activeSession.id, stripAttachmentBlocks(entry.text))
    dispatch({ type: 'SET_IMAGES', images: entry.images })
  }, [activeSession.id, setDraftInput, setDraftSnippets, dispatch])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (handleMentionKeyDown(e)) return

    const noAutocomplete = !showSlash && !mention.showMention

    if (e.key === 'Escape' && noAutocomplete) {
      if (isRunning) { stopSession(activeSession.id); return }
      const now = Date.now()
      const isDouble = now - lastEscapeRef.current < 500
      lastEscapeRef.current = now
      if (isDouble && (input || snippets.length > 0 || attachedImages.length > 0)) {
        historyIndexRef.current = -1
        savedDraftRef.current = ''
        savedDraftSnippetsRef.current = []
        savedDraftImagesRef.current = []
        restoreEntry({ text: '', images: [] })
        return
      }
    }
    if (e.key === 'c' && e.ctrlKey && isRunning) {
      e.preventDefault()
      stopSession(activeSession.id)
      return
    }

    if (showSlash) {
      const filtered = filterSlashCommands(slashCommands, slashFilter)
      if (e.key === 'ArrowDown') { e.preventDefault(); dispatch({ type: 'SLASH_NAV', direction: 'down', maxIndex: filtered.length - 1 }); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); dispatch({ type: 'SLASH_NAV', direction: 'up', maxIndex: filtered.length - 1 }); return }
      if ((e.key === 'Tab' || e.key === 'Enter') && filtered[slashIndex]) { e.preventDefault(); handleSlashSelect(filtered[slashIndex].name); return }
      if (e.key === 'Escape') { dispatch({ type: 'CLOSE_SLASH' }); return }
    }

    // Message history navigation: ↑ when empty, ↓ when browsing
    if (e.key === 'ArrowUp' && noAutocomplete && (input === '' || historyIndexRef.current !== -1)) {
      if (userMessages.length === 0) return
      e.preventDefault()
      if (historyIndexRef.current === -1) {
        savedDraftRef.current = input
        savedDraftSnippetsRef.current = snippets
        savedDraftImagesRef.current = attachedImages
        historyIndexRef.current = userMessages.length - 1
      } else if (historyIndexRef.current > 0) {
        historyIndexRef.current--
      }
      restoreEntry(userMessages[historyIndexRef.current])
      return
    }
    if (e.key === 'ArrowDown' && noAutocomplete && historyIndexRef.current !== -1) {
      e.preventDefault()
      if (historyIndexRef.current < userMessages.length - 1) {
        historyIndexRef.current++
        restoreEntry(userMessages[historyIndexRef.current])
      } else {
        historyIndexRef.current = -1
        setDraftSnippets(activeSession.id, savedDraftSnippetsRef.current)
        setDraftInput(activeSession.id, savedDraftRef.current)
        dispatch({ type: 'SET_IMAGES', images: savedDraftImagesRef.current })
      }
      return
    }

    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend() }
  }, [handleMentionKeyDown, showSlash, mention.showMention, slashCommands, slashFilter, slashIndex, handleSlashSelect, dispatch, onSend, isRunning, stopSession, activeSession.id, userMessages, input, snippets, attachedImages, setDraftInput, setDraftSnippets, restoreEntry])

  // ─── Queue editing ─────────────────────────────────────────────────────────

  const handleStartEditQueue = useCallback(() => {
    setEditingQueue(activeSession.id, true)
  }, [activeSession.id, setEditingQueue])

  const commitQueueEdit = useCallback(() => {
    const trimmed = queueEditValue.trim()
    if (!trimmed && !queuedMessage?.images?.length) {
      setQueuedMessage(activeSession.id, null)
    } else {
      setQueuedMessage(activeSession.id, { text: trimmed, images: queuedMessage?.images })
    }
    dispatch({ type: 'STOP_EDIT_QUEUE' })
    setEditingQueue(activeSession.id, false)
    // If Claude finished while we were editing, send now
    drainDeferredQueue(activeSession.id)
  }, [activeSession.id, queueEditValue, queuedMessage, setQueuedMessage, setEditingQueue, dispatch, drainDeferredQueue])

  const cancelQueueEdit = useCallback(() => {
    dispatch({ type: 'STOP_EDIT_QUEUE' })
    setEditingQueue(activeSession.id, false)
    // If Claude finished while we were editing, send the original queued message
    drainDeferredQueue(activeSession.id)
  }, [activeSession.id, setEditingQueue, dispatch, drainDeferredQueue])

  const handleDiscardQueue = useCallback(() => {
    setQueuedMessage(activeSession.id, null)
    setEditingQueue(activeSession.id, false)
    dispatch({ type: 'STOP_EDIT_QUEUE' })
  }, [activeSession.id, setQueuedMessage, setEditingQueue, dispatch])

  // ─── Prompts ───────────────────────────────────────────────────────────────

  const handlePlanApprove = useCallback(() => approvePlan(activeSession.id), [activeSession.id, approvePlan])
  const handlePlanReject = useCallback((reason?: string) => rejectPlan(activeSession.id, reason), [activeSession.id, rejectPlan])
  const handleAllowTool = useCallback(() => allowTool(activeSession.id), [activeSession.id, allowTool])
  const handleAlwaysAllowTool = useCallback((rule: string) => alwaysAllowTool(activeSession.id, rule), [activeSession.id, alwaysAllowTool])
  const handleDenyTool = useCallback(() => denyTool(activeSession.id), [activeSession.id, denyTool])

  // ─── Misc ──────────────────────────────────────────────────────────────────

  const handleCompactClick = useCallback(() => {
    setDraftInput(activeSession.id, '/compact')
    textareaRef.current?.focus()
  }, [activeSession.id, setDraftInput, textareaRef])

  const handleTextareaChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    handleInputChange(e.target.value)
  }, [handleInputChange])

  const handleTextareaScroll = useCallback(() => {
    const bd = textareaRef.current?.parentElement?.querySelector('.chat-input-backdrop') as HTMLElement | null
    if (bd && textareaRef.current) bd.scrollTop = textareaRef.current.scrollTop
  }, [textareaRef])

  const handleRemoveSnippet = useCallback((id: string) => {
    removeDraftSnippet(activeSession.id, id)
  }, [activeSession.id, removeDraftSnippet])

  const contextPercent = useMemo(() => {
    if (activeSession.contextTokens == null) return 0
    const window = getContextWindow(activeSession.model, activeSession.extendedContext)
    return activeSession.contextTokens / window
  }, [activeSession.contextTokens, activeSession.model, activeSession.extendedContext])

  // Hide the compact warning if /compact is already queued or already typed,
  // or if the last message is a compact-boundary (compaction just happened with no new user turn yet)
  const isCompactPending = useMemo(() => {
    if (queuedMessage?.text?.trim() === '/compact') return true
    if (input.trim() === '/compact') return true
    const lastMsg = activeSession.messages.at(-1)
    return lastMsg?.tag === 'compact-boundary'
  }, [queuedMessage, input, activeSession.messages])

  const placeholder = useMemo(() => {
    if (isWaitingInput) return t('placeholderWaitingInput')
    if (isRunning) return queuedMessage !== null ? t('placeholderQueued') : t('placeholderQueueNext')
    if (attachedImages.length > 0) return t('placeholderHasImage')
    if (mentionFiles.length > 0) return t('placeholderHasFiles')
    if (snippets.length > 0) return t('placeholderHasSnippets')
    if (activeSession.planModeEnabled) return t('placeholderPlanMode')
    return t('placeholderDefault')
  }, [isWaitingInput, isRunning, queuedMessage, attachedImages.length, mentionFiles.length, snippets.length, activeSession.planModeEnabled, t])

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className={`chat-input-area${isDragOver ? ' chat-input-area--drag-over' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Prompt overlays - hidden in diff variant */}
      {variant === 'default' && isWaitingInput && activeSession.pendingPlanApproval && (
        <ExitPlanModePrompt
          onApprove={handlePlanApprove}
          onReject={handlePlanReject}
          planFilePath={activeSession.pendingPlanApproval.planFilePath}
        />
      )}
      {variant === 'default' && isWaitingInput && activeSession.pendingToolPermission && (
        <ToolPermissionPrompt
          pendingToolPermission={activeSession.pendingToolPermission}
          onAllow={handleAllowTool}
          onAlwaysAllow={handleAlwaysAllowTool}
          onDeny={handleDenyTool}
        />
      )}
      {variant === 'default' && activeSession.status === 'error' && activeSession.pendingAuthError && (
        <AuthErrorPrompt
          pendingAuthError={activeSession.pendingAuthError}
          onRetry={() => retryAfterAuth(activeSession.id)}
          onDismiss={() => dismissAuthError(activeSession.id)}
        />
      )}
      {variant === 'default' && isWaitingInput && activeSession.pendingElicitation && (
        <ElicitationPrompt
          pendingElicitation={activeSession.pendingElicitation}
          onAccept={(content) => answerElicitation(activeSession.id, { action: 'accept', content })}
          onDecline={() => answerElicitation(activeSession.id, { action: 'decline' })}
        />
      )}

      {/* Drag overlay */}
      {isDragOver && (
        <div className="chat-drag-overlay">
          <div className="chat-drag-overlay-inner">
            <IconArrowDown size={32} style={{ strokeWidth: 1.5 }} />
            <span>{t('dropFileHint')}</span>
          </div>
        </div>
      )}

      {/* Image previews */}
      {attachedImages.length > 0 && (
        <div className="chat-image-previews">
          {/* Inline closure acceptable — parameterized by loop index */}
          {attachedImages.map((uri, i) => (
            <div key={i} className="chat-image-preview">
              <img src={uri} alt={`Attachment ${i + 1}`} />
              <button
                className="chat-image-preview-remove"
                onClick={() => dispatch({ type: 'REMOVE_IMAGE', index: i })}
                aria-label={t('removeImage')}
              >
                <IconClose />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* File / terminal mention chips */}
      {mentionFiles.length > 0 && (
        <div className="mention-file-chips">
          {mentionFiles.map((f: AttachedFile, i: number) => {
            const isTerminal = f.path === TERMINAL_ENTRY
            return (
              <div key={f.path} className={`mention-file-chip${isTerminal ? ' mention-file-chip--terminal' : ''}`}>
                <span className="mention-file-chip-icon">{isTerminal ? '>_' : '@'}</span>
                <span className="mention-file-chip-name" title={isTerminal ? t('mentionTerminal') : f.path}>
                  {isTerminal ? t('mentionTerminal') : f.path.split('/').pop()}
                </span>
                <button
                  className="mention-file-chip-remove"
                  onClick={() => mention.removeFile(i)}
                  title={t('removeFile')}
                >
                  <IconClose />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {snippets.length > 0 && (
        <SnippetChips snippets={snippets} onRemove={handleRemoveSnippet} />
      )}

      {variant === 'default' && (
        <LinkedWorktreeChips sessionId={activeSession.id} worktreeId={activeSession.worktreeId} />
      )}

      {variant === 'default' && contextPercent >= CONTEXT_WARN_THRESHOLD && !isCompactPending && (
        <button
          className={`context-warning-nudge${contextPercent >= CONTEXT_CRITICAL_THRESHOLD ? ' context-warning-nudge--critical' : ''}`}
          onClick={handleCompactClick}
          title={t('contextWarningTooltip')}
        >
          <span className="context-warning-icon">⚠</span>
          <span>{t('contextWarning', { percent: Math.round(contextPercent * 100) })}</span>
          <span className="context-warning-action">{t('contextWarningAction')}</span>
        </button>
      )}

      {/* Textarea + autocompletes */}
      <div className="chat-input-container">
        {showSlash && (
          <SlashAutocomplete filter={slashFilter} selectedIndex={slashIndex} onSelect={handleSlashSelect} />
        )}
        {mention.showMention && (
          <MentionAutocomplete
            filter={mention.mentionFilter}
            files={mention.filteredFiles}
            isLoading={mention.isLoadingFiles}
            selectedIndex={mention.mentionIndex}
            onSelect={mention.selectMention}
          />
        )}
        <div className="chat-input-highlight-wrap">
          {input && <InputHighlightBackdrop text={input} />}
          <textarea
            ref={textareaRef}
            className={`chat-input${input ? ' chat-input--has-backdrop' : ''}`}
            value={input}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onScroll={handleTextareaScroll}
            placeholder={placeholder}
            disabled={(isRunning && queuedMessage !== null) || isWaitingInput}
            rows={1}
          />
        </div>
        {!(isRunning && queuedMessage !== null) && !isWaitingInput && !input && (
          <span className="chat-input-hint">{t('focusHint')}</span>
        )}
      </div>

      {/* Queued message banner - hidden in diff variant */}
      {variant === 'default' && queuedMessage !== null && (
        <QueuedMessageBanner
          queuedMessage={queuedMessage}
          editingQueue={editingQueue}
          queueEditValue={queueEditValue}
          queueEditRef={queueEditRef}
          dispatch={dispatch}
          onStartEdit={handleStartEditQueue}
          onCommitEdit={commitQueueEdit}
          onCancelEdit={cancelQueueEdit}
          onDiscard={handleDiscardQueue}
        />
      )}
    </div>
  )
}
