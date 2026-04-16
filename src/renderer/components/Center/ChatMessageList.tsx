import { useCallback, useRef, useLayoutEffect, memo } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { useActiveSession, useSessionsStore } from '@/store/sessions'
import { useUIStore } from '@/store/ui'
import { ChatMessage } from './ChatMessage'
import { ActivityIndicator } from './ActivityIndicator'
import { AskUserQuestionPrompt } from './AskUserQuestionPrompt'
import type { Message } from '@/types'
import { IconArrowDown } from '@/components/shared/icons'
import { useTranslation } from 'react-i18next'
import { ChatScrollContext } from '@/lib/chatScrollContext'

// ─── Stable Virtuoso component references ─────────────────────────────────────
// Defined at module scope so their identity never changes between renders.
// Inline definitions inside a component create new references on every re-render,
// causing Virtuoso to unmount and remount (visible as ActivityIndicator flickering).

const VirtuosoHeader = () => <div style={{ height: 20 }} />

const FooterContent = memo(function FooterContent({ itemClassName = 'chat-virtuoso-item' }: { itemClassName?: string }) {
  const session = useActiveSession()
  const answerQuestion = useSessionsStore((s) => s.answerQuestion)
  const isRunning = session?.status === 'running'
  const isWaitingInput = session?.status === 'waiting_input'
  const showActivity = (isRunning || isWaitingInput) && session?.activity
  const sessionId = session?.id

  const handleAnswerSubmit = useCallback((answers: Record<string, string>) => {
    if (sessionId) answerQuestion(sessionId, answers)
  }, [sessionId, answerQuestion])

  return (
    // Fixed-height container prevents scroll bounce when activity toggles.
    <div style={{ minHeight: 68 }}>
      {showActivity ? (
        <div className={itemClassName}>
          <ActivityIndicator
            activity={session.activity!}
            runStartedAt={session.runStartedAt}
            contextTokens={session.contextTokens}
          />
        </div>
      ) : null}
      {isWaitingInput && session?.pendingQuestion && (
        <div className={itemClassName}>
          <AskUserQuestionPrompt
            pendingQuestion={session.pendingQuestion}
            onSubmit={handleAnswerSubmit}
          />
        </div>
      )}
      <div style={{ height: 20 }} />
    </div>
  )
})

const VirtuosoFooter = () => <FooterContent />
const VIRTUOSO_COMPONENTS = { Header: VirtuosoHeader, Footer: VirtuosoFooter }

// ─── Shared scroll-to-bottom button ─────────────────────────────────────────

function ScrollToBottomButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation('center')
  return (
    <button className="scroll-to-bottom-btn" onClick={onClick} aria-label={t('scrollToBottom')}>
      <IconArrowDown />
    </button>
  )
}

// ─── Plain (non-virtualized) list ───────────────────────────────────────────

const BOTTOM_THRESHOLD = 200

interface PlainMessageListProps {
  renderItems: Message[]
  sessionId: string
  atBottom: boolean
  handleScrollerRef: (el: HTMLElement | null) => void
  handleAtBottomChange: (atBottom: boolean) => void
  disengageScroll: () => void
  handleScrollToBottom: () => void
}

const PlainMessageList = memo(function PlainMessageList({
  renderItems, sessionId, atBottom,
  handleScrollerRef, handleAtBottomChange, disengageScroll, handleScrollToBottom,
}: PlainMessageListProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // Register the scroller with useChatScroll (it owns all scroll logic via
  // event listeners attached inside handleScrollerRef).
  const setScrollRef = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el
    handleScrollerRef(el)
  }, [handleScrollerRef])

  // Start scrolled to bottom on mount and when session changes.
  // useLayoutEffect fires after the full subtree renders but before paint,
  // so scrollHeight is accurate and no flash occurs.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [sessionId])

  // Feed atBottom state to useChatScroll via scroll events.
  // Matches Virtuoso's atBottomThreshold of 200px.
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    handleAtBottomChange(distFromBottom <= BOTTOM_THRESHOLD)
  }, [handleAtBottomChange])

  return (
    <div className="chat-virtuoso-wrapper">
      <ChatScrollContext.Provider value={disengageScroll}>
        <div ref={setScrollRef} className="chat-plain-scroller" onScroll={handleScroll}>
          <div style={{ height: 20 }} />
          {renderItems.map((message) => (
            <div key={message.id} className="chat-plain-item">
              <ChatMessage message={message} />
            </div>
          ))}
          <FooterContent itemClassName="chat-plain-item" />
        </div>
        {!atBottom && <ScrollToBottomButton onClick={handleScrollToBottom} />}
      </ChatScrollContext.Provider>
    </div>
  )
})

// ─── Props ─────────────────────────────────────────────────────────────────────

interface ChatMessageListProps {
  renderItems: Message[]
  /** Key - Virtuoso remounts when sessionId changes to reset scroll position */
  sessionId: string
  atBottom: boolean
  isRunning: boolean
  isWaitingInput: boolean
  virtuosoRef: React.RefObject<VirtuosoHandle | null>
  handleScrollerRef: (el: HTMLElement | null) => void
  handleAtBottomChange: (atBottom: boolean) => void
  disengageScroll: () => void
  handleScrollToBottom: () => void
}

// ─── Exported component ─────────────────────────────────────────────────────

export function ChatMessageList({
  renderItems, sessionId, atBottom, isRunning, isWaitingInput,
  virtuosoRef, handleScrollerRef, handleAtBottomChange, disengageScroll, handleScrollToBottom,
}: ChatMessageListProps) {
  const noVirtualization = useUIStore((s) => s.experimentalNoVirtualization)

  // Stable callbacks for Virtuoso - must be stable references to avoid unmount/remount
  const computeItemKey = useCallback((_index: number, msg: Message) => msg.id, [])
  const itemContent = useCallback((_index: number, message: Message) => (
    <div className="chat-virtuoso-item">
      <ChatMessage message={message} />
    </div>
  ), [])

  if (noVirtualization) {
    return (
      <PlainMessageList
        renderItems={renderItems}
        sessionId={sessionId}
        atBottom={atBottom}
        handleScrollerRef={handleScrollerRef}
        handleAtBottomChange={handleAtBottomChange}
        disengageScroll={disengageScroll}
        handleScrollToBottom={handleScrollToBottom}
      />
    )
  }

  return (
    <div className="chat-virtuoso-wrapper">
      <ChatScrollContext.Provider value={disengageScroll}>
        <Virtuoso
          key={sessionId}
          ref={virtuosoRef}
          scrollerRef={(el) => { if (!(el instanceof Window)) handleScrollerRef(el) }}
          style={{ height: '100%', width: '100%' }}
          data={renderItems}
          followOutput={isRunning || isWaitingInput ? false : 'auto'}
          initialTopMostItemIndex={renderItems.length - 1}
          increaseViewportBy={{ top: 400, bottom: 200 }}
          computeItemKey={computeItemKey}
          atBottomThreshold={200}
          atBottomStateChange={handleAtBottomChange}
          itemContent={itemContent}
          components={VIRTUOSO_COMPONENTS}
        />
        {!atBottom && <ScrollToBottomButton onClick={handleScrollToBottom} />}
      </ChatScrollContext.Provider>
    </div>
  )
}
