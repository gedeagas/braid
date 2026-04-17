/**
 * ChatHeader - bottom controls bar for the chat input area.
 *
 * Contains: model selector (with 1M context toggle), stop button,
 * thinking/plan-mode toggles, image attach button, and the send button.
 * Extracted from ChatView.tsx to keep that file under the 450-line limit.
 */
import { useCallback } from 'react'
import { useSessionsStore } from '@/store/sessions'
import { useUIStore } from '@/store/ui'
import type { ModelId, EffortLevel, AgentSession } from '@/types'
import type { ChatViewAction } from './ChatView'
import { Tooltip } from '@/components/shared/Tooltip'
import { ModelSelector } from './ModelSelector'
import {
  IconLightbulb, IconClipboardCheck, IconStop,
  IconImage, IconClock, IconArrowUp,
} from '@/components/shared/icons'
import { useTranslation } from 'react-i18next'

export type ChatHeaderVariant = 'default' | 'diff'

interface ChatHeaderProps {
  activeSession: AgentSession
  isRunning: boolean
  isWaitingInput: boolean
  attachedImages: string[]
  queuedMessage: { text: string; images?: string[] } | null
  /** True when the textarea has non-empty text (determines send button queue style) */
  hasInput: boolean
  canSend: boolean
  dispatch: React.Dispatch<ChatViewAction>
  fileInputRef: React.RefObject<HTMLInputElement | null>
  onSend: () => void
  onAddImages: (files: File[]) => void
  /** 'diff' hides thinking/plan toggles, stop button, and image attach */
  variant?: ChatHeaderVariant
}

export function ChatHeader({
  activeSession, isRunning, isWaitingInput,
  attachedImages, queuedMessage, hasInput, canSend, dispatch, fileInputRef,
  onSend, onAddImages, variant = 'default',
}: ChatHeaderProps) {
  const { t } = useTranslation('center')
  const updateModel = useSessionsStore((s) => s.updateModel)
  const updateThinking = useSessionsStore((s) => s.updateThinking)
  const updateExtendedContext = useSessionsStore((s) => s.updateExtendedContext)
  const updateEffortLevel = useSessionsStore((s) => s.updateEffortLevel)
  const updatePlanMode = useSessionsStore((s) => s.updatePlanMode)
  const stopSession = useSessionsStore((s) => s.stopSession)
  const setDraftInput = useSessionsStore((s) => s.setDraftInput)
  const setQueuedMessage = useSessionsStore((s) => s.setQueuedMessage)
  const defaultModel = useUIStore((s) => s.defaultModel)
  const setDefaultModel = useUIStore((s) => s.setDefaultModel)

  const handleModelSelect = useCallback((modelId: ModelId) => {
    updateModel(activeSession.id, modelId)
  }, [activeSession.id, updateModel])

  const handleExtendedContextToggle = useCallback((enabled: boolean) => {
    updateExtendedContext(activeSession.id, enabled)
  }, [activeSession.id, updateExtendedContext])

  const handleEffortChange = useCallback((level: EffortLevel) => {
    updateEffortLevel(activeSession.id, level)
  }, [activeSession.id, updateEffortLevel])

  const handleSetDefault = useCallback((modelId: ModelId) => {
    setDefaultModel(modelId)
  }, [setDefaultModel])

  const handleStop = useCallback(() => {
    if (queuedMessage !== null) {
      setDraftInput(activeSession.id, queuedMessage.text)
      if (queuedMessage.images?.length) dispatch({ type: 'SET_IMAGES', images: queuedMessage.images })
      setQueuedMessage(activeSession.id, null)
      dispatch({ type: 'STOP_EDIT_QUEUE' })
    }
    stopSession(activeSession.id)
  }, [activeSession.id, queuedMessage, setQueuedMessage, setDraftInput, stopSession, dispatch])

  const toggleThinking = useCallback(() => {
    updateThinking(activeSession.id, !activeSession.thinkingEnabled)
  }, [activeSession.id, activeSession.thinkingEnabled, updateThinking])

  const togglePlanMode = useCallback(() => {
    updatePlanMode(activeSession.id, !activeSession.planModeEnabled)
  }, [activeSession.id, activeSession.planModeEnabled, updatePlanMode])

  const openFilePicker = useCallback(() => fileInputRef.current?.click(), [fileInputRef])

  const handleFileInputChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length > 0) await onAddImages(files)
    e.target.value = ''
  }, [onAddImages])

  const isQueueMode = isRunning && (hasInput || attachedImages.length > 0)

  return (
    <div className="chat-bottom-bar">
      <div className="chat-bottom-left">
        {/* Model selector (includes 1M context toggle in dropdown) */}
        <ModelSelector
          currentModelId={activeSession.model}
          extendedContext={activeSession.extendedContext}
          effortLevel={activeSession.effortLevel}
          defaultModelId={defaultModel}
          onSelect={handleModelSelect}
          onToggleExtendedContext={handleExtendedContextToggle}
          onChangeEffortLevel={handleEffortChange}
          onSetDefault={handleSetDefault}
        />

        {variant === 'default' && (
          <>
            {/* Stop button - visible when agent is running or waiting for input */}
            {(isRunning || isWaitingInput) && (
              <Tooltip content={t(queuedMessage !== null ? 'stopRestoreTooltip' : 'stopTooltip')}>
                <button className="chat-bottom-chip chip-stop" onClick={handleStop}>
                  <IconStop />
                  <span>{t(queuedMessage !== null ? 'stopRestore' : 'stop')}</span>
                </button>
              </Tooltip>
            )}

            {/* Thinking toggle */}
            <Tooltip content={t('thinkingTooltip')}>
              <button
                className={`chat-bottom-chip ${activeSession.thinkingEnabled ? 'chip-active' : ''}`}
                onClick={toggleThinking}
              >
                <span className="chip-icon"><IconLightbulb /></span>
                <span>{t('thinking')}</span>
              </button>
            </Tooltip>

            {/* Plan mode toggle */}
            <Tooltip content={t('planModeTooltip')}>
              <button
                className={`chat-bottom-chip ${activeSession.planModeEnabled ? 'chip-active' : ''}`}
                onClick={togglePlanMode}
              >
                <span className="chip-icon"><IconClipboardCheck /></span>
                <span>{t('planMode')}</span>
              </button>
            </Tooltip>

            {/* Image attach */}
            <Tooltip content={t('attachImage')}>
              <button
                className={`chat-bottom-chip chat-attach-btn${attachedImages.length > 0 ? ' chip-active' : ''}`}
                onClick={openFilePicker}
                disabled={isWaitingInput}
              >
                <IconImage />
                <span>{attachedImages.length > 0 ? t('imageCount', { count: attachedImages.length }) : t('imageLabel')}</span>
              </button>
            </Tooltip>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              multiple
              style={{ display: 'none' }}
              onChange={handleFileInputChange}
            />
          </>
        )}
      </div>

      {/* Send / Queue button */}
      <div className="chat-bottom-right">
        <Tooltip content={t(isQueueMode ? 'sendAfterCurrent' : 'sendMessage')} shortcut="↵">
          <button
            className={`chat-send-btn${isQueueMode ? ' chat-send-btn--queue' : ''}`}
            onClick={onSend}
            disabled={!canSend}
          >
            {isQueueMode ? <IconClock /> : <IconArrowUp />}
          </button>
        </Tooltip>
      </div>
    </div>
  )
}
