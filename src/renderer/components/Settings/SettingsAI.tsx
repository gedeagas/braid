import { useReducer } from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/store/ui'
import { flash } from '@/store/flash'
import { dialog, claudeCli } from '@/lib/ipc'
import { SegmentedControl } from '@/components/shared/SegmentedControl'
import type { ModelId } from '@/types'

const MODELS: { value: ModelId; label: string }[] = [
  { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { value: 'claude-opus-4-6', label: 'Opus 4.6' },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
]

/**
 * Text-input + useReducer pattern for settings with multiple draft fields.
 *
 * Rule: 2+ local draft values → useReducer, not multiple useState.
 * Rule: text inputs keep a local draft and persist to the store on onBlur.
 *       Toggles and selects persist immediately via onChange.
 *
 * See SettingsGeneral.tsx for the simpler Toggle/SegmentedControl patterns.
 */
interface State {
  showKey: boolean
  apiKeyDraft: string
  systemPromptDraft: string
  cliPathDraft: string
  detecting: boolean
}

type Action =
  | { type: 'toggleShowKey' }
  | { type: 'setApiKey'; value: string }
  | { type: 'setSystemPrompt'; value: string }
  | { type: 'setCliPath'; value: string }
  | { type: 'setDetecting'; value: boolean }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'toggleShowKey': return { ...state, showKey: !state.showKey }
    case 'setApiKey': return { ...state, apiKeyDraft: action.value }
    case 'setSystemPrompt': return { ...state, systemPromptDraft: action.value }
    case 'setCliPath': return { ...state, cliPathDraft: action.value }
    case 'setDetecting': return { ...state, detecting: action.value }
  }
}

export function SettingsAI() {
  const { t } = useTranslation('settings')
  const defaultModel = useUIStore((s) => s.defaultModel)
  const setDefaultModel = useUIStore((s) => s.setDefaultModel)
  const apiKey = useUIStore((s) => s.apiKey)
  const setApiKey = useUIStore((s) => s.setApiKey)
  const systemPromptSuffix = useUIStore((s) => s.systemPromptSuffix)
  const setSystemPromptSuffix = useUIStore((s) => s.setSystemPromptSuffix)
  const claudeCodeExecutablePath = useUIStore((s) => s.claudeCodeExecutablePath)
  const setClaudeCodeExecutablePath = useUIStore((s) => s.setClaudeCodeExecutablePath)

  const [state, dispatch] = useReducer(reducer, {
    showKey: false,
    apiKeyDraft: apiKey ?? '',
    systemPromptDraft: systemPromptSuffix,
    cliPathDraft: claudeCodeExecutablePath,
    detecting: false,
  })

  const handleBrowseCliPath = async () => {
    const files = await dialog.openFiles()
    if (files?.[0]) {
      dispatch({ type: 'setCliPath', value: files[0] })
      setClaudeCodeExecutablePath(files[0])
    }
  }

  const handleDetectCliPath = async () => {
    dispatch({ type: 'setDetecting', value: true })
    try {
      const detected = await claudeCli.detectPath()
      if (detected) {
        dispatch({ type: 'setCliPath', value: detected })
        setClaudeCodeExecutablePath(detected)
      } else {
        flash('warning', t('ai.cliNotFound'))
      }
    } finally {
      dispatch({ type: 'setDetecting', value: false })
    }
  }

  return (
    <div className="settings-section">
      <div className="settings-field settings-field--row">
        <label className="settings-label">{t('ai.defaultModel')}</label>
        <SegmentedControl
          options={MODELS.map(({ value, label }) => ({ value, label }))}
          value={defaultModel}
          onChange={(v) => setDefaultModel(v as ModelId)}
        />
      </div>

      <div className="settings-field">
        <label className="settings-label">{t('ai.systemPrompt')}</label>
        <span className="settings-hint">{t('ai.systemPromptHint')}</span>
        <textarea
          className="settings-textarea"
          value={state.systemPromptDraft}
          rows={4}
          onChange={(e) => dispatch({ type: 'setSystemPrompt', value: e.target.value })}
          onBlur={() => setSystemPromptSuffix(state.systemPromptDraft)}
        />
      </div>

      <div className="settings-field">
        <label className="settings-label">{t('ai.apiKeyOverride')}</label>
        <span className="settings-hint">{t('ai.apiKeyHint')}</span>
        <div className="settings-input-row">
          <input
            className="settings-input"
            type={state.showKey ? 'text' : 'password'}
            value={state.apiKeyDraft}
            placeholder="API key..."
            onChange={(e) => dispatch({ type: 'setApiKey', value: e.target.value })}
            onBlur={() => setApiKey(state.apiKeyDraft || null)}
          />
          <button className="btn" onClick={() => dispatch({ type: 'toggleShowKey' })}>
            {state.showKey ? t('ai.hideKey') : t('ai.showKey')}
          </button>
        </div>
      </div>

      <div className="settings-field">
        <label className="settings-label">{t('ai.claudeCliPath')}</label>
        <span className="settings-hint">{t('ai.claudeCliPathHint')}</span>
        <div className="settings-input-row">
          <input
            className="settings-input"
            type="text"
            value={state.cliPathDraft}
            placeholder={t('ai.claudeCliPlaceholder')}
            onChange={(e) => dispatch({ type: 'setCliPath', value: e.target.value })}
            onBlur={() => setClaudeCodeExecutablePath(state.cliPathDraft)}
          />
          <button className="btn" onClick={handleDetectCliPath} disabled={state.detecting}>
            {state.detecting ? t('ai.claudeCliDetecting') : t('ai.claudeCliDetect')}
          </button>
          <button className="btn" onClick={handleBrowseCliPath}>
            {t('ai.claudeCliBrowse')}
          </button>
        </div>
      </div>
    </div>
  )
}
