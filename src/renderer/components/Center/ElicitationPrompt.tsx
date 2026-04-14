import { useEffect, useRef, useReducer, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { PendingElicitation } from '@/types'
import { Spinner } from '@/components/ui/Spinner'
import { IconLock, IconExternalLink } from '@/components/shared/icons'
import * as ipc from '@/lib/ipc'

interface Props {
  pendingElicitation: PendingElicitation
  onAccept: (content?: Record<string, unknown>) => void
  onDecline: () => void
}

// ── State ─────────────────────────────────────────────────────────────────────

type State = {
  browserOpened: boolean
  formValues: Record<string, string>
}

type Action =
  | { type: 'OPEN_BROWSER' }
  | { type: 'SET_FIELD'; key: string; value: string }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'OPEN_BROWSER':
      return { ...state, browserOpened: true }
    case 'SET_FIELD':
      return { ...state, formValues: { ...state.formValues, [action.key]: action.value } }
  }
}

// ── URL Mode (OAuth browser flow) ────────────────────────────────────────────

function UrlModeBody({
  pendingElicitation,
  state,
  dispatch,
  onDecline,
}: {
  pendingElicitation: PendingElicitation
  state: State
  dispatch: React.Dispatch<Action>
  onDecline: () => void
}) {
  const { t } = useTranslation('center')

  const handleOpenBrowser = useCallback(() => {
    if (pendingElicitation.url) {
      ipc.shell.openExternal(pendingElicitation.url)
      dispatch({ type: 'OPEN_BROWSER' })
    }
  }, [pendingElicitation.url, dispatch])

  // Auto-open browser on first render
  useEffect(() => {
    if (pendingElicitation.url && !state.browserOpened) {
      handleOpenBrowser()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="elicitation-body">
        <span className="elicitation-badge">{pendingElicitation.serverName}</span>
        {pendingElicitation.message && (
          <p className="elicitation-message">{pendingElicitation.message}</p>
        )}
        <div className="elicitation-status">
          <Spinner size="sm" />
          <span>{t('elicitationWaiting')}</span>
        </div>
      </div>
      <div className="elicitation-actions">
        <button className="elicitation-open-btn" onClick={handleOpenBrowser}>
          <IconExternalLink size={12} />
          {t('elicitationOpenBrowser')}
        </button>
        <button className="elicitation-cancel-btn" onClick={onDecline}>
          {t('elicitationCancel')}
        </button>
      </div>
    </>
  )
}

// ── Form Mode (structured input) ─────────────────────────────────────────────

function FormModeBody({
  pendingElicitation,
  state,
  dispatch,
  onAccept,
  onDecline,
}: {
  pendingElicitation: PendingElicitation
  state: State
  dispatch: React.Dispatch<Action>
  onAccept: (content?: Record<string, unknown>) => void
  onDecline: () => void
}) {
  const { t } = useTranslation('center')
  const schema = pendingElicitation.requestedSchema
  const properties = (schema?.properties ?? {}) as Record<string, { type?: string; description?: string }>
  const fields = Object.entries(properties)

  const handleSubmit = useCallback(() => {
    // Convert string form values back to typed values per schema
    const typed: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(state.formValues)) {
      const prop = properties[key]
      if (prop?.type === 'boolean') {
        typed[key] = value === 'true'
      } else {
        typed[key] = value
      }
    }
    onAccept(typed)
  }, [onAccept, state.formValues, properties])

  return (
    <>
      <div className="elicitation-body">
        <span className="elicitation-badge">{pendingElicitation.serverName}</span>
        {pendingElicitation.message && (
          <p className="elicitation-message">{pendingElicitation.message}</p>
        )}
        {fields.length > 0 && (
          <div className="elicitation-form">
            {fields.map(([key, prop]) => (
              <div key={key} className="elicitation-field">
                <label className="elicitation-field-label">{key}</label>
                {prop.description && (
                  <span className="elicitation-field-hint">{prop.description}</span>
                )}
                {prop.type === 'boolean' ? (
                  <input
                    className="elicitation-field-input"
                    type="checkbox"
                    checked={state.formValues[key] === 'true'}
                    onChange={(e) => dispatch({ type: 'SET_FIELD', key, value: String(e.target.checked) })}
                  />
                ) : (
                  <input
                    className="elicitation-field-input"
                    type="text"
                    value={state.formValues[key] ?? ''}
                    onChange={(e) => dispatch({ type: 'SET_FIELD', key, value: e.target.value })}
                    placeholder={key}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="elicitation-actions">
        <button className="elicitation-submit-btn" onClick={handleSubmit}>
          {t('elicitationSubmit')}
        </button>
        <button className="elicitation-cancel-btn" onClick={onDecline}>
          {t('elicitationCancel')}
        </button>
      </div>
    </>
  )
}

// ── Main Component ───────────────────────────────────────────────────────────

export function ElicitationPrompt({ pendingElicitation, onAccept, onDecline }: Props) {
  const { t } = useTranslation('center')
  const promptRef = useRef<HTMLDivElement>(null)
  const [state, dispatch] = useReducer(reducer, { browserOpened: false, formValues: {} })

  useEffect(() => {
    promptRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [])

  const isUrlMode = pendingElicitation.mode === 'url'

  return (
    <div className="elicitation-prompt" ref={promptRef}>
      <div className="elicitation-header">
        <IconLock size={11} className="elicitation-header-icon" />
        <span className="elicitation-header-text">
          {isUrlMode ? t('elicitationTitle') : t('elicitationFormTitle')}
        </span>
      </div>

      {isUrlMode ? (
        <UrlModeBody
          pendingElicitation={pendingElicitation}
          state={state}
          dispatch={dispatch}
          onDecline={onDecline}
        />
      ) : (
        <FormModeBody
          pendingElicitation={pendingElicitation}
          state={state}
          dispatch={dispatch}
          onAccept={onAccept}
          onDecline={onDecline}
        />
      )}
    </div>
  )
}
