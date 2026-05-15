import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { PendingQuestion } from '@/types'

interface Props {
  pendingQuestion: PendingQuestion
  onSubmit: (answers: Record<string, string>) => void
}

export function AskUserQuestionPrompt({ pendingQuestion, onSubmit }: Props) {
  const { t } = useTranslation('center')
  const promptRef = useRef<HTMLDivElement>(null)
  // selections: header → array of selected labels (safe for labels containing commas)
  const [selections, setSelections] = useState<Record<string, string[]>>({})
  const [otherValues, setOtherValues] = useState<Record<string, string>>({})

  // Scroll into view and play entrance when prompt appears
  useEffect(() => {
    promptRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [])

  const setAnswer = (header: string, value: string, multi: boolean) => {
    if (!multi) {
      setSelections((s) => ({ ...s, [header]: [value] }))
    } else {
      setSelections((s) => {
        const current = s[header] ?? []
        const idx = current.indexOf(value)
        if (idx >= 0) return { ...s, [header]: current.filter((_, i) => i !== idx) }
        return { ...s, [header]: [...current, value] }
      })
    }
  }

  const isSelected = (header: string, label: string): boolean => {
    return (selections[header] ?? []).includes(label)
  }

  const isOtherSelected = (header: string): boolean => {
    return (selections[header] ?? []).includes('__other__')
  }

  const handleSubmit = () => {
    // SDK keys answers by question text, not header (AskUserQuestionOutput in
    // @anthropic-ai/claude-agent-sdk).
    const final: Record<string, string> = {}
    for (const q of pendingQuestion.questions) {
      const answers = (selections[q.header] ?? []).filter((l) => l !== '__other__')
      const other = otherValues[q.header]?.trim()
      if (other) answers.push(other)
      if (answers.length) final[q.question] = answers.join(', ')
    }
    onSubmit(final)
  }

  const allAnswered = pendingQuestion.questions.every((q) => {
    const hasSelection = (selections[q.header] ?? []).filter((l) => l !== '__other__').length > 0
    const hasOther = (otherValues[q.header] ?? '').trim().length > 0
    return hasSelection || hasOther
  })

  return (
    <div className="ask-user-prompt" ref={promptRef}>
      <div className="ask-user-header">
        <span className="ask-user-header-icon">⊙</span>
        <span className="ask-user-header-text">{t('claudeNeedsInput')}</span>
      </div>

      {pendingQuestion.questions.map((q) => {
        const otherActive = isOtherSelected(q.header)
        return (
          <div key={q.header} className="ask-user-question">
            <div className="ask-user-question-title">{q.question}</div>
            <div className="ask-user-question-tag">{q.header}</div>

            <div className="ask-user-options">
              {q.options.map((opt) => {
                const selected = isSelected(q.header, opt.label)
                return (
                  <button
                    key={opt.label}
                    className={`ask-user-option ${selected ? 'selected' : ''}`}
                    onClick={() => {
                      setAnswer(q.header, opt.label, q.multiSelect)
                    }}
                  >
                    <span className="ask-user-option-indicator">
                      {q.multiSelect
                        ? (selected ? '☑' : '☐')
                        : (selected ? '◉' : '○')}
                    </span>
                    <span className="ask-user-option-body">
                      <span className="ask-user-option-label">{opt.label}</span>
                      {opt.description && (
                        <span className="ask-user-option-desc">{opt.description}</span>
                      )}
                    </span>
                  </button>
                )
              })}

              {/* Other option */}
              <button
                className={`ask-user-option ${otherActive ? 'selected' : ''}`}
                onClick={() => {
                  // For single-select, replace all selections with __other__
                  if (!q.multiSelect) {
                    setSelections((s) => ({ ...s, [q.header]: ['__other__'] }))
                  } else {
                    setAnswer(q.header, '__other__', true)
                  }
                }}
              >
                <span className="ask-user-option-indicator">{otherActive ? '◉' : '○'}</span>
                <span className="ask-user-option-body">
                  <span className="ask-user-option-label">{t('other')}</span>
                  <span className="ask-user-option-desc">{t('otherCustomHint')}</span>
                </span>
              </button>

              {otherActive && (
                <input
                  className="ask-user-other-input"
                  type="text"
                  placeholder={t('otherInputPlaceholder')}
                  autoFocus
                  value={otherValues[q.header] ?? ''}
                  onChange={(e) => setOtherValues((v) => ({ ...v, [q.header]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && allAnswered) handleSubmit()
                  }}
                />
              )}
            </div>
          </div>
        )
      })}

      <div className="ask-user-actions">
        <button
          className="ask-user-submit-btn"
          disabled={!allAnswered}
          onClick={handleSubmit}
        >
          {t('submit', { ns: 'common' })}
        </button>
      </div>
    </div>
  )
}
