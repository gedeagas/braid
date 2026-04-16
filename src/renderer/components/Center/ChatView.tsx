/**
 * ChatView — composition root for the chat panel.
 *
 * Manages: session state, message merging (renderItems), refs shared across
 * children, the send action, and the useReducer for ephemeral UI state.
 *
 * Child components:
 *   ChatMessageList — Virtuoso message list + auto-scroll
 *   ChatInput       — textarea, drag-drop, images, snippets, autocomplete, queue
 *   ChatHeader      — model selector, toggles, send button (bottom bar)
 */
import { useState, useReducer, useRef, useEffect, useCallback, useMemo, lazy, Suspense } from 'react'
import { useChatScroll } from '@/hooks/useChatScroll'
import { type VirtuosoHandle } from 'react-virtuoso'
import { useShallow } from 'zustand/shallow'
import { useSessionsStore, useActiveSession } from '@/store/sessions'
import { useUIStore, selectSelectedDiffFile, selectActiveCenterView } from '@/store/ui'
import { ChatMessageList } from './ChatMessageList'
import { ChatInput, MAX_IMAGES, ACCEPTED_IMAGE_TYPES, MAX_IMAGE_SIZE } from './ChatInput'
import { compressImage } from '@/lib/imageCompression'
import { ChatHeader } from './ChatHeader'
import { buildDiffCommentBlocks } from './diffCommentUtils'
import type { Message, SlashCommand, SnippetAttachment, DiffComment } from '@/types'
import { IconMessageBubble, IconSparkle } from '@/components/shared/icons'
import { Spinner } from '@/components/ui'
import { flash } from '@/store/flash'
import { useTranslation } from 'react-i18next'
import { useMentionAutocomplete } from './useMentionAutocomplete'
import { BranchBar } from './BranchBar'

const DiffReviewView = lazy(() => import('./DiffReviewView').then((m) => ({ default: m.DiffReviewView })))

// ─── Constants ─────────────────────────────────────────────────────────────────

const EMPTY_COMMANDS: SlashCommand[] = []

function buildSnippetBlocks(snippets: SnippetAttachment[]): string {
  return snippets.map((s) => `<snippet lines="${s.lineCount}">\n${s.content}\n</snippet>`).join('\n\n')
}

// ─── Reducer (local ephemeral UI state) ───────────────────────────────────────

export interface ChatViewState {
  attachedImages: string[]
  isDragOver: boolean
  showSlash: boolean
  slashFilter: string
  slashIndex: number
  editingQueue: boolean
  queueEditValue: string
}

export type ChatViewAction =
  | { type: 'APPEND_IMAGES'; uris: string[] }
  | { type: 'REMOVE_IMAGE'; index: number }
  | { type: 'SET_IMAGES'; images: string[] }
  | { type: 'SET_DRAG_OVER'; value: boolean }
  | { type: 'OPEN_SLASH'; filter: string }
  | { type: 'CLOSE_SLASH' }
  | { type: 'SLASH_NAV'; direction: 'up' | 'down'; maxIndex: number }
  | { type: 'START_EDIT_QUEUE'; text: string }
  | { type: 'SET_QUEUE_EDIT_VALUE'; value: string }
  | { type: 'STOP_EDIT_QUEUE' }
  | { type: 'SENT' }
  | { type: 'SENT_SCROLL' }
  | { type: 'SESSION_SWITCH' }

const initialChatViewState: ChatViewState = {
  attachedImages: [],
  isDragOver: false,
  showSlash: false,
  slashFilter: '',
  slashIndex: 0,
  editingQueue: false,
  queueEditValue: '',
}

function chatViewReducer(state: ChatViewState, action: ChatViewAction): ChatViewState {
  switch (action.type) {
    case 'APPEND_IMAGES': return { ...state, attachedImages: [...state.attachedImages, ...action.uris] }
    case 'REMOVE_IMAGE': return { ...state, attachedImages: state.attachedImages.filter((_, i) => i !== action.index) }
    case 'SET_IMAGES': {
      if (state.attachedImages.length === 0 && action.images.length === 0) return state
      if (state.attachedImages === action.images) return state
      return { ...state, attachedImages: action.images }
    }
    case 'SET_DRAG_OVER': return state.isDragOver === action.value ? state : { ...state, isDragOver: action.value }
    case 'OPEN_SLASH': return { ...state, showSlash: true, slashFilter: action.filter, slashIndex: 0 }
    case 'CLOSE_SLASH': return state.showSlash ? { ...state, showSlash: false } : state
    case 'SLASH_NAV': return {
      ...state,
      slashIndex: action.direction === 'down'
        ? Math.min(state.slashIndex + 1, action.maxIndex)
        : Math.max(state.slashIndex - 1, 0),
    }
    case 'START_EDIT_QUEUE': return { ...state, editingQueue: true, queueEditValue: action.text }
    case 'SET_QUEUE_EDIT_VALUE': return { ...state, queueEditValue: action.value }
    case 'STOP_EDIT_QUEUE': return state.editingQueue ? { ...state, editingQueue: false } : state
    case 'SENT': return { ...state, attachedImages: [], showSlash: false }
    case 'SENT_SCROLL': return { ...state, attachedImages: [], showSlash: false }
    case 'SESSION_SWITCH': return { ...state, editingQueue: false, attachedImages: [], showSlash: false }
    default: return state
  }
}

// ─── Component ─────────────────────────────────────────────────────────────────

interface ChatViewProps {
  worktreePath?: string
}

export function ChatView({ worktreePath = '' }: ChatViewProps) {
  const [state, dispatch] = useReducer(chatViewReducer, initialChatViewState)
  const { attachedImages } = state

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const queueEditRef = useRef<HTMLTextAreaElement>(null)
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const mergedCacheRef = useRef(new Map<string, Message>())
  const prevSessionIdRef = useRef<string | null>(null)
  const diffCommentsRef = useRef<DiffComment[]>([])
  const [diffCommentCount, setDiffCommentCount] = useState(0)
  const clearDiffCommentsRef = useRef<(() => void) | null>(null)

  const activeSession = useActiveSession()
  const activeCenterView = useUIStore(selectActiveCenterView)
  const selectedDiffFile = useUIStore(selectSelectedDiffFile)
  const setActiveCenterView = useUIStore((s) => s.setActiveCenterView)
  const isChangesMode = activeCenterView?.type === 'changes'
  const sendMessage = useSessionsStore((s) => s.sendMessage)
  const setQueuedMessage = useSessionsStore((s) => s.setQueuedMessage)
  const setEditingQueue = useSessionsStore((s) => s.setEditingQueue)
  const drainDeferredQueue = useSessionsStore((s) => s.drainDeferredQueue)
  const setDraftInput = useSessionsStore((s) => s.setDraftInput)
  const clearDraftSnippets = useSessionsStore((s) => s.clearDraftSnippets)
  const slashCommands = useSessionsStore(
    useShallow((s) => s.activeSessionId ? (s.sessions[s.activeSessionId]?.slashCommands ?? EMPTY_COMMANDS) : EMPTY_COMMANDS)
  )
  const input = useSessionsStore((s) => activeSession ? (s.draftInputs[activeSession.id] ?? '') : '')
  const snippets = useSessionsStore(
    useShallow((s) => activeSession ? (s.draftSnippets[activeSession.id] ?? []) : [])
  )
  const queuedMessage = useSessionsStore((s) =>
    activeSession ? (s.queuedMessages[activeSession.id] ?? null) : null
  )

  const { t } = useTranslation('center')

  const setDraftInputForMention = useCallback((value: string) => {
    if (activeSession) setDraftInput(activeSession.id, value)
  }, [activeSession, setDraftInput])

  const mention = useMentionAutocomplete(activeSession ?? null, input, setDraftInputForMention)

  const isRunning = activeSession?.status === 'running'
  const isWaitingInput = activeSession?.status === 'waiting_input'

  const { handleScrollerRef, handleAtBottomChange, atBottom, setAtBottom,
    engageScroll, disengageScroll, scrollerRef } = useChatScroll({ isStreaming: isRunning || isWaitingInput })

  // ─── Effects ────────────────────────────────────────────────────────────────

  useEffect(() => {
    const handler = () => textareaRef.current?.focus()
    window.addEventListener('braid:focusChat', handler)
    return () => window.removeEventListener('braid:focusChat', handler)
  }, [])

  useEffect(() => {
    const prevId = prevSessionIdRef.current
    if (prevId !== null && prevId !== activeSession?.id) {
      dispatch({ type: 'SESSION_SWITCH' })
      // If the user was editing the queue on the previous session, clear the
      // editing flag and drain the queue (it may have been deferred by handleDone).
      setEditingQueue(prevId, false)
      drainDeferredQueue(prevId)
      mention.clearFiles()
      engageScroll()
      const scrollEl = scrollerRef.current
      if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight
      else virtuosoRef.current?.scrollToIndex({ index: 'LAST', behavior: 'auto' })
    }
    prevSessionIdRef.current = activeSession?.id ?? null
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession?.id])

  // Clear diff comments when worktree changes (prevent cross-worktree leakage)
  const prevWorktreeRef = useRef(worktreePath)
  useEffect(() => {
    if (prevWorktreeRef.current !== worktreePath) {
      prevWorktreeRef.current = worktreePath
      diffCommentsRef.current = []
      setDiffCommentCount(0)
      clearDiffCommentsRef.current?.()
    }
  }, [worktreePath])

  // ─── Image management ──────────────────────────────────────────────────────

  const addImages = useCallback(async (files: File[]) => {
    const imageFiles = files.filter((f) => ACCEPTED_IMAGE_TYPES.includes(f.type))
    if (imageFiles.length === 0) return
    const valid = imageFiles.filter((f) => {
      if (f.size > MAX_IMAGE_SIZE) { flash('warning', t('imageTooLarge')); return false }
      return true
    })
    if (valid.length === 0) return
    const remaining = MAX_IMAGES - attachedImages.length
    if (remaining <= 0) { flash('warning', t('imageLimitReached')); return }
    const toAdd = valid.slice(0, remaining)
    if (toAdd.length < valid.length) flash('warning', t('imageLimitReached'))
    const results = await Promise.allSettled(toAdd.map(compressImage))
    const failed = results.filter((r) => r.status === 'rejected').length
    if (failed > 0) flash('warning', t('imageLoadFailed', { count: failed }))
    const uris = results
      .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
      .map((r) => r.value)
    if (uris.length === 0) return
    dispatch({ type: 'APPEND_IMAGES', uris })
  }, [attachedImages.length, dispatch, t])

  // ─── Diff comments (changes mode) ───────────────────────────────────────────

  const handleDiffCommentsChange = useCallback((comments: DiffComment[]) => {
    diffCommentsRef.current = comments
    setDiffCommentCount(comments.length)
  }, [])

  const handleRegisterClear = useCallback((clearFn: () => void) => {
    clearDiffCommentsRef.current = clearFn
  }, [])

  // ─── Send ───────────────────────────────────────────────────────────────────

  const handleSend = useCallback(() => {
    if (!activeSession) return
    const hasText = input.trim().length > 0
    const hasImages = attachedImages.length > 0
    const hasSnippets = snippets.length > 0
    const diffComments = isChangesMode ? diffCommentsRef.current : []
    const { attachedFiles: mentionFiles, buildPromptWithFiles, clearFiles: clearMentionFiles } = mention
    if (!hasText && !hasImages && mentionFiles.length === 0 && !hasSnippets && diffComments.length === 0) return

    let prompt = buildPromptWithFiles(input.trim())
    if (hasSnippets) {
      const blocks = buildSnippetBlocks(snippets)
      prompt = prompt ? `${blocks}\n\n${prompt}` : blocks
    }
    if (diffComments.length > 0) {
      const diffBlocks = buildDiffCommentBlocks(diffComments)
      prompt = prompt ? `${diffBlocks}\n\n${prompt}` : diffBlocks
    }
    if (hasImages) {
      const imgTags = attachedImages.map((uri, i) => `[Image ${i + 1}]: ${uri}`).join('\n')
      prompt = prompt ? `${imgTags}\n\n${prompt}` : imgTags
    }

    if (isRunning) {
      if (queuedMessage === null) {
        // Reuse the already-built prompt (includes snippets, diff comments, images, mentions)
        setQueuedMessage(activeSession.id, { text: prompt, images: hasImages ? attachedImages : undefined })
        setDraftInput(activeSession.id, '')
        dispatch({ type: 'SENT' })
        clearMentionFiles()
        if (hasSnippets) clearDraftSnippets(activeSession.id)
        if (diffComments.length > 0) {
          diffCommentsRef.current = []
          setDiffCommentCount(0)
          clearDiffCommentsRef.current?.()
        }
      }
      return
    }

    sendMessage(activeSession.id, prompt, attachedImages)
    setDraftInput(activeSession.id, '')
    dispatch({ type: 'SENT_SCROLL' })
    clearMentionFiles()
    if (hasSnippets) clearDraftSnippets(activeSession.id)

    // After sending diff comments, clear them and switch to the session chat view
    if (diffComments.length > 0) {
      diffCommentsRef.current = []
      setDiffCommentCount(0)
      clearDiffCommentsRef.current?.()
      setActiveCenterView({ type: 'session', sessionId: activeSession.id })
    }

    engageScroll()
    const scrollEl = scrollerRef.current
    if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight
    else virtuosoRef.current?.scrollTo({ top: Number.MAX_SAFE_INTEGER, behavior: 'auto' })
  // Destructure stable references from mention (which is a new object each render) to
  // avoid defeating useCallback. The hook's returned functions are referentially stable.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession, input, attachedImages, snippets, isChangesMode,
      mention.attachedFiles, mention.buildPromptWithFiles, mention.clearFiles,
      isRunning, queuedMessage, sendMessage, setQueuedMessage, setDraftInput, clearDraftSnippets,
      engageScroll, setActiveCenterView])

  // ─── Scroll to bottom ──────────────────────────────────────────────────────

  const handleScrollToBottom = useCallback(() => {
    engageScroll()
    setAtBottom(true)
    const el = scrollerRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    else virtuosoRef.current?.scrollTo({ top: Number.MAX_SAFE_INTEGER, behavior: 'smooth' })
  }, [setAtBottom, scrollerRef, engageScroll])

  // ─── Message merging ───────────────────────────────────────────────────────
  // Group consecutive assistant messages that contain tool calls into single merged messages.
  // Results are cached by composite key so React.memo on ChatMessage skips unchanged groups.

  const renderItems: Message[] = useMemo(() => {
    if (!activeSession) return []
    const nextCache = new Map<string, Message>()
    const items: Message[] = []
    let toolGroup: Message[] = []

    const flushGroup = () => {
      if (toolGroup.length === 0) return
      if (toolGroup.length === 1) {
        items.push(toolGroup[0])
      } else {
        const key = toolGroup.map((m) => m.id).join('|')
        const hasPartial = toolGroup.some((m) => m.isPartial)
        const prev = !hasPartial ? mergedCacheRef.current.get(key) : undefined
        if (prev) { nextCache.set(key, prev); items.push(prev) }
        else {
          const merged: Message = {
            ...toolGroup[0],
            blocks: toolGroup.flatMap((m) => m.blocks ?? []),
            toolCalls: toolGroup.flatMap((m) => m.toolCalls ?? []),
            content: toolGroup.map((m) => m.content).filter(Boolean).join('\n\n'),
            isPartial: hasPartial,
          }
          if (!hasPartial) nextCache.set(key, merged)
          items.push(merged)
        }
      }
      toolGroup = []
    }

    for (const msg of activeSession.messages) {
      const hasTools = msg.role === 'assistant' && msg.blocks?.some((b) => b.type === 'tool_use')
      if (hasTools) toolGroup.push(msg)
      else { flushGroup(); items.push(msg) }
    }
    flushGroup()
    mergedCacheRef.current = nextCache
    return items
  // eslint-disable-next-line react-hooks/exhaustive-deps -- activeSession identity covers null→non-null transitions
  }, [activeSession, activeSession?.messages])

  // ─── Render ────────────────────────────────────────────────────────────────

  if (!activeSession) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon"><IconMessageBubble size={56} /></div>
        <div className="empty-state-text">{t('selectWorktreeHint')}</div>
      </div>
    )
  }

  const canSend = (input.trim().length > 0 || attachedImages.length > 0 || mention.attachedFiles.length > 0 || diffCommentCount > 0) &&
    !(isRunning && queuedMessage !== null) && !isWaitingInput

  return (
    <>
      {isChangesMode ? (
        <Suspense fallback={<div className="diff-review diff-review--loading"><Spinner size="md" /></div>}>
          <DiffReviewView
            filePath={selectedDiffFile?.path ?? null}
            worktreePath={worktreePath}
            fileStatus={selectedDiffFile?.status}
            fileStaged={selectedDiffFile?.staged}
            onCommentsChange={handleDiffCommentsChange}
            onRegisterClear={handleRegisterClear}
            initialComments={diffCommentsRef.current}
          />
        </Suspense>
      ) : activeSession.messages.length === 0 ? (
        <div className="chat-container">
          <div className="chat-empty-hint">
            <div className="chat-empty-icon"><IconSparkle size={32} /></div>
            <div className="chat-empty-text">{t('startConversation')}</div>
          </div>
        </div>
      ) : (
        <ChatMessageList
          renderItems={renderItems}
          sessionId={activeSession.id}
          atBottom={atBottom}
          isRunning={!!isRunning}
          isWaitingInput={!!isWaitingInput}
          virtuosoRef={virtuosoRef}
          handleScrollerRef={handleScrollerRef}
          handleAtBottomChange={handleAtBottomChange}
          disengageScroll={disengageScroll}
          handleScrollToBottom={handleScrollToBottom}
        />
      )}

      <div className={`chat-input-float${!isChangesMode && activeSession.planModeEnabled ? ' chat-input-float--plan-mode' : ''}`}>
        {isChangesMode && diffCommentCount > 0 && (
          <div className="diff-comment-chips-info">
            <span className="diff-comment-chips-icon">+/-</span>
            <span>{t('diffCommentCount', { count: diffCommentCount })}</span>
          </div>
        )}
        <ChatInput
          activeSession={activeSession}
          input={input}
          snippets={snippets}
          slashCommands={slashCommands}
          mention={mention}
          isRunning={!!isRunning}
          isWaitingInput={!!isWaitingInput}
          state={state}
          dispatch={dispatch}
          textareaRef={textareaRef}
          queueEditRef={queueEditRef}
          onSend={handleSend}
          onAddImages={addImages}
          variant={isChangesMode ? 'diff' : 'default'}
        />

        <ChatHeader
          activeSession={activeSession}
          isRunning={!!isRunning}
          isWaitingInput={!!isWaitingInput}
          attachedImages={attachedImages}
          queuedMessage={queuedMessage}
          hasInput={input.trim().length > 0}
          canSend={canSend}
          dispatch={dispatch}
          fileInputRef={fileInputRef}
          onSend={handleSend}
          onAddImages={addImages}
          variant={isChangesMode ? 'diff' : 'default'}
        />

      </div>

      {!isChangesMode && (
        <div className="chat-input-footer">
          <BranchBar />
        </div>
      )}
    </>
  )
}
