import { useReducer, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useProjectsStore } from '@/store/projects'
import { useUIStore } from '@/store/ui'
import * as ipc from '@/lib/ipc'
import { Toggle } from '@/components/shared/Toggle'
import { SegmentedControl } from '@/components/shared/SegmentedControl'
import { ProjectPillDropdown } from '@/components/shared/ProjectPillDropdown'


// ── Rule parsing ────────────────────────────────────────────────────────────

/** Parse "Bash(git merge:*)" → { tool: "Bash", detail: "git merge:*" } */
function parseRule(rule: string): { tool: string; detail: string } {
  const m = rule.match(/^(\w+)\((.+)\)$/)
  if (m) return { tool: m[1], detail: m[2] }
  return { tool: rule, detail: '' }
}

/** Rebuild "Bash(git merge:*)" from parts */
function formatRule(tool: string, detail: string): string {
  const t = tool.trim()
  const d = detail.trim()
  if (!t) return ''
  return d ? `${t}(${d})` : t
}

// ── Reducer ──────────────────────────────────────────────────────────────────

type Scope = 'global' | 'project'

interface State {
  scope: Scope
  localProjectId: string | null
  allow: string[]
  deny: string[]
  projectAllow: string[]
  projectDeny: string[]
  newTool: string
  newDetail: string
  newType: 'allow' | 'deny'
  loading: boolean
}

type Action =
  | { type: 'setScope'; scope: Scope }
  | { type: 'setLocalProject'; id: string | null }
  | { type: 'setGlobalRules'; allow: string[]; deny: string[] }
  | { type: 'setProjectRules'; allow: string[]; deny: string[] }
  | { type: 'setNewTool'; value: string }
  | { type: 'setNewDetail'; value: string }
  | { type: 'setNewType'; value: 'allow' | 'deny' }
  | { type: 'clearNew' }
  | { type: 'setLoading'; loading: boolean }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'setScope': return { ...state, scope: action.scope }
    case 'setLocalProject': return { ...state, localProjectId: action.id, projectAllow: [], projectDeny: [] }
    case 'setGlobalRules': return { ...state, allow: action.allow, deny: action.deny }
    case 'setProjectRules': return { ...state, projectAllow: action.allow, projectDeny: action.deny }
    case 'setNewTool': return { ...state, newTool: action.value }
    case 'setNewDetail': return { ...state, newDetail: action.value }
    case 'setNewType': return { ...state, newType: action.value }
    case 'clearNew': return { ...state, newTool: '', newDetail: '' }
    case 'setLoading': return { ...state, loading: action.loading }
  }
}

// ── Component ────────────────────────────────────────────────────────────────

export function SettingsClaudePermissions() {
  const { t } = useTranslation('settings')
  const projects = useProjectsStore((s) => s.projects)
  const bypassPermissions = useUIStore((s) => s.bypassPermissions)
  const setBypassPermissions = useUIStore((s) => s.setBypassPermissions)

  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    scope: 'global' as Scope,
    localProjectId: useUIStore.getState().selectedProjectId ?? null,
    allow: [],
    deny: [],
    projectAllow: [],
    projectDeny: [],
    newTool: '',
    newDetail: '',
    newType: 'allow' as const,
    loading: true,
  }))

  const stateRef = useRef(state)
  stateRef.current = state

  const projectsRef = useRef(projects)
  projectsRef.current = projects

  // Load global permissions
  useEffect(() => {
    dispatch({ type: 'setLoading', loading: true })
    ipc.claudeConfig.getPermissions()
      .then(({ allow, deny }) => dispatch({ type: 'setGlobalRules', allow, deny }))
      .finally(() => dispatch({ type: 'setLoading', loading: false }))
  }, [])

  // Load project permissions when localProjectId changes
  useEffect(() => {
    const project = projectsRef.current.find((p) => p.id === state.localProjectId)
    if (!project) return
    ipc.claudeConfig.getProjectPermissions(project.path)
      .then(({ allow, deny }) => dispatch({ type: 'setProjectRules', allow, deny }))
  }, [state.localProjectId]) // eslint-disable-line react-hooks/exhaustive-deps

  const saveGlobal = useCallback((allow: string[], deny: string[]) => {
    ipc.claudeConfig.setPermissions({ allow, deny })
  }, [])

  const saveProject = useCallback((allow: string[], deny: string[]) => {
    const project = projectsRef.current.find((p) => p.id === stateRef.current.localProjectId)
    if (!project) return
    ipc.claudeConfig.setProjectPermissions(project.path, { allow, deny })
  }, [])

  const addRule = useCallback(() => {
    const rule = formatRule(stateRef.current.newTool, stateRef.current.newDetail)
    if (!rule) return
    const { scope, newType } = stateRef.current
    if (scope === 'global') {
      const existing = newType === 'allow' ? stateRef.current.allow : stateRef.current.deny
      if (existing.includes(rule)) return // prevent duplicates
      const allow = newType === 'allow' ? [...stateRef.current.allow, rule] : stateRef.current.allow
      const deny = newType === 'deny' ? [...stateRef.current.deny, rule] : stateRef.current.deny
      dispatch({ type: 'setGlobalRules', allow, deny })
      saveGlobal(allow, deny)
    } else {
      const existing = newType === 'allow' ? stateRef.current.projectAllow : stateRef.current.projectDeny
      if (existing.includes(rule)) return // prevent duplicates
      const allow = newType === 'allow' ? [...stateRef.current.projectAllow, rule] : stateRef.current.projectAllow
      const deny = newType === 'deny' ? [...stateRef.current.projectDeny, rule] : stateRef.current.projectDeny
      dispatch({ type: 'setProjectRules', allow, deny })
      saveProject(allow, deny)
    }
    dispatch({ type: 'clearNew' })
  }, [saveGlobal, saveProject])

  const removeRule = useCallback((rule: string, listType: 'allow' | 'deny') => {
    const { scope } = stateRef.current
    if (scope === 'global') {
      const allow = listType === 'allow' ? stateRef.current.allow.filter((r) => r !== rule) : stateRef.current.allow
      const deny = listType === 'deny' ? stateRef.current.deny.filter((r) => r !== rule) : stateRef.current.deny
      dispatch({ type: 'setGlobalRules', allow, deny })
      saveGlobal(allow, deny)
    } else {
      const allow = listType === 'allow' ? stateRef.current.projectAllow.filter((r) => r !== rule) : stateRef.current.projectAllow
      const deny = listType === 'deny' ? stateRef.current.projectDeny.filter((r) => r !== rule) : stateRef.current.projectDeny
      dispatch({ type: 'setProjectRules', allow, deny })
      saveProject(allow, deny)
    }
  }, [saveGlobal, saveProject])

  const allowList = state.scope === 'global' ? state.allow : state.projectAllow
  const denyList = state.scope === 'global' ? state.deny : state.projectDeny
  const localProject = projects.find((p) => p.id === state.localProjectId)
  const showProjectEmpty = state.scope === 'project' && !localProject

  return (
    <div className="settings-section">
      <div className="settings-field">
        <label className="settings-label">{t('claudePermissions.title')}</label>
        <span className="settings-hint">{t('claudePermissions.hint')}</span>
      </div>

      <div className="settings-field settings-field--row">
        <div>
          <label className="settings-label">{t('claudePermissions.bypassPermissions')}</label>
          <span className="settings-hint">{t('claudePermissions.bypassPermissionsHint')}</span>
        </div>
        <Toggle checked={bypassPermissions} onChange={setBypassPermissions} />
      </div>

      <div className="settings-divider" />

      <SegmentedControl
        options={[
          { value: 'global' as Scope, label: t('claudePermissions.global') },
          { value: 'project' as Scope, label: t('claudePermissions.project') },
        ]}
        value={state.scope}
        onChange={(v) => dispatch({ type: 'setScope', scope: v })}
      />

      {state.scope === 'project' && (
        <div className="settings-claude-project-row">
          <ProjectPillDropdown
            projects={projects}
            value={state.localProjectId}
            onChange={(id) => dispatch({ type: 'setLocalProject', id })}
            placeholder={t('claudeAgent.selectProjectPlaceholder')}
          />
        </div>
      )}

      {showProjectEmpty ? (
        <p className="settings-empty-state">{t('claudePermissions.selectProject')}</p>
      ) : (
        <>
          {/* Allowed rules */}
          <div className="settings-field">
            <span className="settings-section-subtitle">{t('claudePermissions.allowed')}</span>
            <div className="settings-patterns-tags">
              {allowList.length === 0 && (
                <span className="settings-empty-state">{t('claudePermissions.noRules')}</span>
              )}
              {allowList.map((rule) => {
                const { tool, detail } = parseRule(rule)
                return (
                  <span key={rule} className="settings-pattern-tag settings-rule-tag--allow">
                    <span className="settings-pattern-tag-text">
                      <strong>{tool}</strong>{detail ? ` (${detail})` : ''}
                    </span>
                    <button
                      className="settings-pattern-tag-remove"
                      onClick={() => removeRule(rule, 'allow')}
                    >
                      &times;
                    </button>
                  </span>
                )
              })}
            </div>
          </div>

          {/* Denied rules */}
          <div className="settings-field">
            <span className="settings-section-subtitle">{t('claudePermissions.denied')}</span>
            <div className="settings-patterns-tags">
              {denyList.length === 0 && (
                <span className="settings-empty-state">{t('claudePermissions.noRules')}</span>
              )}
              {denyList.map((rule) => {
                const { tool, detail } = parseRule(rule)
                return (
                  <span key={rule} className="settings-pattern-tag settings-rule-tag--deny">
                    <span className="settings-pattern-tag-text">
                      <strong>{tool}</strong>{detail ? ` (${detail})` : ''}
                    </span>
                    <button
                      className="settings-pattern-tag-remove"
                      onClick={() => removeRule(rule, 'deny')}
                    >
                      &times;
                    </button>
                  </span>
                )
              })}
            </div>
          </div>

          {/* Add rule */}
          <div className="settings-field">
            <span className="settings-section-subtitle">{t('claudePermissions.addRule')}</span>
            <div className="settings-rule-add-row">
              <SegmentedControl
                options={[
                  { value: 'allow', label: t('claudePermissions.allowed') },
                  { value: 'deny',  label: t('claudePermissions.denied')  },
                ]}
                value={state.newType}
                onChange={(v) => dispatch({ type: 'setNewType', value: v as 'allow' | 'deny' })}
              />
              <input
                className="settings-input"
                type="text"
                value={state.newTool}
                placeholder={t('claudePermissions.toolPlaceholder')}
                onChange={(e) => dispatch({ type: 'setNewTool', value: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && addRule()}
              />
              <input
                className="settings-input"
                type="text"
                value={state.newDetail}
                placeholder={t('claudePermissions.patternPlaceholder')}
                onChange={(e) => dispatch({ type: 'setNewDetail', value: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && addRule()}
              />
              <button className="btn btn-primary" onClick={addRule} disabled={!state.newTool.trim()}>
                +
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
