import { useReducer, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/store/ui'
import { useShallow } from 'zustand/react/shallow'
import { DEFAULT_PR_PROMPT } from '@/lib/prPrompt'
import { DEFAULT_MERGE_CONFLICT_PROMPT } from '@/lib/mergeConflictPrompt'

interface State {
  branchPrefixDraft: string
  storagePathDraft: string
  patternDraft: string
  prPromptDraft: string
  mergeConflictPromptDraft: string
}

type Action =
  | { type: 'setBranchPrefix'; value: string }
  | { type: 'setStoragePath'; value: string }
  | { type: 'setPatternDraft'; value: string }
  | { type: 'clearPatternDraft' }
  | { type: 'setPrPrompt'; value: string }
  | { type: 'setMergeConflictPrompt'; value: string }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'setBranchPrefix': return { ...state, branchPrefixDraft: action.value }
    case 'setStoragePath': return { ...state, storagePathDraft: action.value }
    case 'setPatternDraft': return { ...state, patternDraft: action.value }
    case 'clearPatternDraft': return { ...state, patternDraft: '' }
    case 'setPrPrompt': return { ...state, prPromptDraft: action.value }
    case 'setMergeConflictPrompt': return { ...state, mergeConflictPromptDraft: action.value }
  }
}

export function SettingsGit() {
  const { t } = useTranslation('settings')
  const defaultBranchPrefix = useUIStore((s) => s.defaultBranchPrefix)
  const setDefaultBranchPrefix = useUIStore((s) => s.setDefaultBranchPrefix)
  const worktreeStoragePath = useUIStore((s) => s.worktreeStoragePath)
  const setWorktreeStoragePath = useUIStore((s) => s.setWorktreeStoragePath)
  const [discoveryPatterns, setDiscoveryPatterns] = useUIStore(
    useShallow((s) => [s.discoveryPatterns, s.setDiscoveryPatterns] as const)
  )
  const pullStrategy = useUIStore((s) => s.pullStrategy)
  const setPullStrategy = useUIStore((s) => s.setPullStrategy)
  const prPrompt = useUIStore((s) => s.prPrompt)
  const setPrPrompt = useUIStore((s) => s.setPrPrompt)
  const mergeConflictPrompt = useUIStore((s) => s.mergeConflictPrompt)
  const setMergeConflictPrompt = useUIStore((s) => s.setMergeConflictPrompt)

  const [state, dispatch] = useReducer(reducer, {
    branchPrefixDraft: defaultBranchPrefix,
    storagePathDraft: worktreeStoragePath,
    patternDraft: '',
    prPromptDraft: prPrompt,
    mergeConflictPromptDraft: mergeConflictPrompt,
  })

  const addPattern = useCallback(() => {
    const trimmed = state.patternDraft.trim()
    if (!trimmed || discoveryPatterns.includes(trimmed)) return
    setDiscoveryPatterns([...discoveryPatterns, trimmed])
    dispatch({ type: 'clearPatternDraft' })
  }, [state.patternDraft, discoveryPatterns, setDiscoveryPatterns])

  const removePattern = useCallback((pattern: string) => {
    setDiscoveryPatterns(discoveryPatterns.filter((p) => p !== pattern))
  }, [discoveryPatterns, setDiscoveryPatterns])

  return (
    <div className="settings-section">
      <div className="settings-field">
        <label className="settings-label">{t('git.branchPrefix')}</label>
        <span className="settings-hint">{t('git.branchPrefixHint')}</span>
        <input
          className="settings-input"
          type="text"
          value={state.branchPrefixDraft}
          placeholder="yourname/"
          onChange={(e) => dispatch({ type: 'setBranchPrefix', value: e.target.value })}
          onBlur={() => setDefaultBranchPrefix(state.branchPrefixDraft)}
        />
      </div>

      <div className="settings-field">
        <label className="settings-label">{t('git.storagePath')}</label>
        <span className="settings-hint">{t('git.storagePathHint')}</span>
        <input
          className="settings-input"
          type="text"
          value={state.storagePathDraft}
          placeholder="~/Braid/worktrees/"
          onChange={(e) => dispatch({ type: 'setStoragePath', value: e.target.value })}
          onBlur={() => setWorktreeStoragePath(state.storagePathDraft)}
        />
      </div>

      <div className="settings-field">
        <label className="settings-label">{t('git.pullStrategy')}</label>
        <span className="settings-hint">{t('git.pullStrategyHint')}</span>
        <select
          className="settings-select"
          value={pullStrategy ?? 'ask'}
          onChange={(e) => {
            const v = e.target.value
            setPullStrategy(v === 'ask' ? null : (v as 'rebase' | 'merge'))
          }}
        >
          <option value="ask">{t('git.pullStrategyAsk')}</option>
          <option value="rebase">{t('git.pullStrategyRebase')}</option>
          <option value="merge">{t('git.pullStrategyMerge')}</option>
        </select>
      </div>

      <div className="settings-field">
        <label className="settings-label">{t('git.discoveryPatterns')}</label>
        <span className="settings-hint">{t('git.discoveryPatternsHint')}</span>
        <div className="settings-patterns-tags">
          {discoveryPatterns.map((p) => (
            <span key={p} className="settings-pattern-tag">
              <span className="settings-pattern-tag-text">{p}</span>
              <button
                className="settings-pattern-tag-remove"
                onClick={() => removePattern(p)}
                aria-label={t('common:remove')}
              >
                &times;
              </button>
            </span>
          ))}
        </div>
        <div className="settings-pattern-add">
          <input
            className="settings-input"
            type="text"
            value={state.patternDraft}
            placeholder={t('git.discoveryPatternPlaceholder')}
            onChange={(e) => dispatch({ type: 'setPatternDraft', value: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && addPattern()}
          />
          <button className="btn" onClick={addPattern} disabled={!state.patternDraft.trim()}>
            {t('common:add')}
          </button>
        </div>
      </div>

      <div className="settings-field">
        <label className="settings-label">{t('git.prPrompt')}</label>
        <span className="settings-hint">{t('git.prPromptHint')}</span>
        <textarea
          className="settings-textarea"
          rows={8}
          value={state.prPromptDraft}
          placeholder={DEFAULT_PR_PROMPT}
          onChange={(e) => dispatch({ type: 'setPrPrompt', value: e.target.value })}
          onBlur={() => setPrPrompt(state.prPromptDraft)}
        />
      </div>

      <div className="settings-field">
        <label className="settings-label">{t('git.mergeConflictPrompt')}</label>
        <span className="settings-hint">{t('git.mergeConflictPromptHint', { placeholder: '{{baseBranch}}' })}</span>
        <textarea
          className="settings-textarea"
          rows={8}
          value={state.mergeConflictPromptDraft}
          placeholder={DEFAULT_MERGE_CONFLICT_PROMPT}
          onChange={(e) => dispatch({ type: 'setMergeConflictPrompt', value: e.target.value })}
          onBlur={() => setMergeConflictPrompt(state.mergeConflictPromptDraft)}
        />
      </div>
    </div>
  )
}
