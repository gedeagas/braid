import { useReducer, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/store/ui'
import { flash } from '@/store/flash'
import { dialog, claudeCli } from '@/lib/ipc'
import { Toggle } from '@/components/shared/Toggle'
import { MODELS } from '@/components/Center/ModelSelector'
import { getEffortLevelsForModel, EFFORT_LEVELS, DEFAULT_EFFORT, supportsEffort } from '@/lib/constants'
import type { ModelId, EffortLevel } from '@/types'

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
  const defaultExtendedContext = useUIStore((s) => s.defaultExtendedContext)
  const setDefaultExtendedContext = useUIStore((s) => s.setDefaultExtendedContext)
  const defaultEffortLevel = useUIStore((s) => s.defaultEffortLevel)
  const setDefaultEffortLevel = useUIStore((s) => s.setDefaultEffortLevel)
  const apiKey = useUIStore((s) => s.apiKey)
  const setApiKey = useUIStore((s) => s.setApiKey)
  const systemPromptSuffix = useUIStore((s) => s.systemPromptSuffix)
  const setSystemPromptSuffix = useUIStore((s) => s.setSystemPromptSuffix)
  const claudeCodeExecutablePath = useUIStore((s) => s.claudeCodeExecutablePath)
  const setClaudeCodeExecutablePath = useUIStore((s) => s.setClaudeCodeExecutablePath)

  const effortSupported = supportsEffort(defaultModel)
  const supportedLevels = useMemo(() => getEffortLevelsForModel(defaultModel), [defaultModel])

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
        <select
          className="settings-select"
          value={defaultModel}
          onChange={(e) => setDefaultModel(e.target.value as ModelId)}
        >
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </div>

      <div className="settings-field settings-field--row">
        <div>
          <label className="settings-label">{t('ai.extendedContext')}</label>
          <span className="settings-hint">{t('ai.extendedContextHint')}</span>
        </div>
        <Toggle
          checked={defaultExtendedContext}
          onChange={setDefaultExtendedContext}
        />
      </div>

      {effortSupported && (
        <div className="settings-field settings-field--row">
          <div>
            <label className="settings-label">{t('ai.defaultEffort')}</label>
            <span className="settings-hint">{t('ai.defaultEffortHint')}</span>
          </div>
          <div className="model-effort-pills">
            {EFFORT_LEVELS.filter((l) => supportedLevels.includes(l.id)).map((l) => (
              <button
                key={l.id}
                className={`model-effort-pill${l.id === defaultEffortLevel ? ' model-effort-pill--active' : ''}`}
                onClick={() => setDefaultEffortLevel(l.id)}
              >
                {t(`ai.effort_${l.id}`, l.label)}
              </button>
            ))}
          </div>
        </div>
      )}

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
