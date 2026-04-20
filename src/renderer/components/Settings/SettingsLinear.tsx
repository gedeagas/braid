import { useReducer, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/store/ui'
import { linear, shell } from '@/lib/ipc'
import { Button } from '@/components/ui/Button'
import { StatusDot } from '@/components/ui/StatusDot'
import { IconExternalLink } from '@/components/shared/icons'

const LINEAR_API_KEY_URL = 'https://linear.app/settings/api'

type TestStatus = 'idle' | 'testing' | 'success' | 'failure'
type SaveState = 'idle' | 'saved'

interface State {
  draft: string
  saveState: SaveState
  testStatus: TestStatus
}

type Action =
  | { type: 'setDraft'; value: string }
  | { type: 'saved' }
  | { type: 'resetSave' }
  | { type: 'testStart' }
  | { type: 'testDone'; ok: boolean }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'setDraft':   return { ...state, draft: action.value, saveState: 'idle' }
    case 'saved':      return { ...state, saveState: 'saved' }
    case 'resetSave':  return { ...state, saveState: 'idle' }
    case 'testStart':  return { ...state, testStatus: 'testing' }
    case 'testDone':   return { ...state, testStatus: action.ok ? 'success' : 'failure' }
  }
}

export function SettingsLinear() {
  const { t } = useTranslation('settings')
  const linearApiKey = useUIStore((s) => s.linearApiKey)
  const setLinearApiKey = useUIStore((s) => s.setLinearApiKey)

  const [state, dispatch] = useReducer(reducer, {
    draft: linearApiKey,
    saveState: 'idle',
    testStatus: 'idle',
  })

  // ── API key save with brief "Saved" flash ───────────────────────────
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }, [])

  const dirty = state.draft.trim() !== linearApiKey

  const handleSave = useCallback(() => {
    const trimmed = state.draft.trim()
    setLinearApiKey(trimmed)
    dispatch({ type: 'setDraft', value: trimmed })
    dispatch({ type: 'saved' })
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => dispatch({ type: 'resetSave' }), 1500)
  }, [state.draft, setLinearApiKey])

  // ── Test connection ─────────────────────────────────────────────────
  const handleTest = useCallback(async () => {
    if (!state.draft.trim()) return
    dispatch({ type: 'testStart' })
    try {
      const ok = await linear.validateApiKey(state.draft.trim())
      dispatch({ type: 'testDone', ok })
    } catch {
      dispatch({ type: 'testDone', ok: false })
    }
  }, [state.draft])

  const dotState =
    state.testStatus === 'success' ? 'success' as const
      : state.testStatus === 'failure' ? 'failure' as const
      : 'pending' as const

  return (
    <div className="settings-section">
      <span className="settings-hint">{t('linear.description')}</span>

      <div className="settings-divider" />

      <div className="settings-field">
        <label className="settings-label">{t('linear.apiKeyLabel')}</label>
        <div style={{ display: 'flex', gap: 'var(--space-8)' }}>
          <input
            type="password"
            className="settings-input"
            style={{ flex: 1 }}
            value={state.draft}
            onChange={(e) => dispatch({ type: 'setDraft', value: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter' && dirty) handleSave() }}
            placeholder={t('linear.apiKeyPlaceholder')}
            spellCheck={false}
            autoComplete="off"
          />
          <Button size="sm" variant="primary" disabled={!dirty && state.saveState === 'idle'} onClick={handleSave}>
            {state.saveState === 'saved' ? t('linear.saved') : t('linear.save')}
          </Button>
        </div>
        <span className="settings-hint">{t('linear.apiKeyHint')}</span>
      </div>

      <div className="settings-divider" />

      <div className="settings-field settings-field--row">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-8)' }}>
          {state.testStatus !== 'idle' && <StatusDot state={dotState} />}
          <span className="settings-label">
            {state.testStatus === 'testing' && t('linear.statusTesting')}
            {state.testStatus === 'success' && t('linear.statusConnected')}
            {state.testStatus === 'failure' && t('linear.statusFailed')}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-8)' }}>
          <Button
            size="sm"
            variant="primary"
            disabled={!state.draft.trim() || state.testStatus === 'testing'}
            loading={state.testStatus === 'testing'}
            onClick={handleTest}
          >
            {t('linear.testConnection')}
          </Button>
          <Button size="sm" onClick={() => shell.openExternal(LINEAR_API_KEY_URL)}>
            {t('linear.getApiKey')} <IconExternalLink size={10} />
          </Button>
        </div>
      </div>
    </div>
  )
}
