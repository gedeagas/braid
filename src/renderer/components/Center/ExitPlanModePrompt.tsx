import { useRef, useEffect, useReducer } from 'react'
import { useTranslation } from 'react-i18next'
import * as ipc from '@/lib/ipc'
import { StreamingMarkdown } from './StreamingMarkdown'

interface Props {
  onApprove: () => void
  onReject: (reason?: string) => void
  planFilePath?: string
}

type State = {
  phase: 'idle' | 'rejecting'
  planContent: string | null
  planExpanded: boolean
  rejectReason: string
}

type Action =
  | { type: 'SET_PLAN_CONTENT'; content: string | null }
  | { type: 'TOGGLE_PLAN' }
  | { type: 'START_REJECTING' }
  | { type: 'CANCEL_REJECTING' }
  | { type: 'SET_REJECT_REASON'; reason: string }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SET_PLAN_CONTENT':
      return { ...state, planContent: action.content }
    case 'TOGGLE_PLAN':
      return { ...state, planExpanded: !state.planExpanded }
    case 'START_REJECTING':
      return { ...state, phase: 'rejecting', rejectReason: '' }
    case 'CANCEL_REJECTING':
      return { ...state, phase: 'idle', rejectReason: '' }
    case 'SET_REJECT_REASON':
      return { ...state, rejectReason: action.reason }
    default:
      return state
  }
}

export function ExitPlanModePrompt({ onApprove, onReject, planFilePath }: Props) {
  const { t } = useTranslation('center')
  const promptRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const [state, dispatch] = useReducer(reducer, {
    phase: 'idle',
    planContent: null,
    planExpanded: true,
    rejectReason: ''
  })

  useEffect(() => {
    promptRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [])

  useEffect(() => {
    if (!planFilePath) return
    ipc.git.readFile(planFilePath)
      .then((content: string) => {
        if (typeof content === 'string' && content.length > 0) {
          dispatch({ type: 'SET_PLAN_CONTENT', content })
        } else {
          dispatch({ type: 'SET_PLAN_CONTENT', content: null })
        }
      })
      .catch((err: unknown) => {
        console.warn('[ExitPlanModePrompt] Failed to load plan file:', err)
        dispatch({ type: 'SET_PLAN_CONTENT', content: null })
      })
  }, [planFilePath])

  // Auto-focus textarea when entering rejection mode
  useEffect(() => {
    if (state.phase === 'rejecting') {
      textareaRef.current?.focus()
    }
  }, [state.phase])

  const handleSubmitRejection = () => {
    const reason = state.rejectReason.trim() || undefined
    onReject(reason)
  }

  const handleRejectKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmitRejection()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      dispatch({ type: 'CANCEL_REJECTING' })
    }
  }

  return (
    <div className="plan-prompt" ref={promptRef}>
      {state.planContent && (
        <div className="plan-content">
          <button
            className="plan-content-toggle"
            onClick={() => dispatch({ type: 'TOGGLE_PLAN' })}
          >
            <span className="plan-content-toggle-icon">{state.planExpanded ? '▾' : '▸'}</span>
            <span className="plan-content-toggle-label">
              {planFilePath?.split('/').slice(-2).join('/') ?? 'Plan'}
            </span>
          </button>
          {state.planExpanded && (
            <div className="plan-content-body">
              <StreamingMarkdown
                content={state.planContent}
                enableHighlight={false}
                enableAnimation={false}
              />
            </div>
          )}
        </div>
      )}
      <div className="plan-prompt-header">
        <span className="plan-prompt-icon">📋</span>
        <span className="plan-prompt-text">{t('planFinished')}</span>
      </div>
      <p className="plan-prompt-desc">
        {state.planContent ? t('planReviewInstruction') : t('planApproveInstruction')}
      </p>

      {state.phase === 'idle' && (
        <div className="plan-prompt-actions">
          <button className="plan-approve-btn" onClick={onApprove}>
            {t('approveAndImplement')}
          </button>
          <button className="plan-reject-btn" onClick={() => dispatch({ type: 'START_REJECTING' })}>
            {t('rejectPlan')}
          </button>
        </div>
      )}

      {state.phase === 'rejecting' && (
        <div className="plan-reject-form">
          <textarea
            ref={textareaRef}
            className="plan-reject-textarea"
            value={state.rejectReason}
            onChange={(e) => dispatch({ type: 'SET_REJECT_REASON', reason: e.target.value })}
            onKeyDown={handleRejectKeyDown}
            placeholder={t('rejectReasonPlaceholder')}
            rows={3}
          />
          <div className="plan-prompt-actions">
            <button className="plan-reject-submit-btn" onClick={handleSubmitRejection}>
              {t('sendRejection')}
            </button>
            <button className="plan-reject-btn" onClick={() => dispatch({ type: 'CANCEL_REJECTING' })}>
              {t('cancelRejection')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
