import { useReducer, useEffect, useCallback, useRef, useMemo } from 'react'
import Editor, { useMonaco } from '@monaco-editor/react'
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from 'react-i18next'
import { useProjectsStore } from '@/store/projects'
import { useUIStore } from '@/store/ui'
import { builtinThemes } from '@/themes/palettes'
import { buildMonacoTheme } from '@/themes/monaco'
import { MONACO_THEME_NAME } from '@/lib/appBrand'
import * as ipc from '@/lib/ipc'
import { SETTINGS_EDITOR_OPTIONS } from './editorOptions'
import { Toggle } from '@/components/shared/Toggle'
import { SegmentedControl } from '@/components/shared/SegmentedControl'
import { ProjectPillDropdown } from '@/components/shared/ProjectPillDropdown'

// ── Types ────────────────────────────────────────────────────────────────────

interface SkillInfo {
  name: string; description: string; path: string; scope: 'global' | 'project'
}

interface SkillDetail {
  name: string; description: string; argumentHint: string
  disableModelInvocation: boolean; allowedTools: string
  body: string; additionalFiles: string[]
}

// ── Reducer ──────────────────────────────────────────────────────────────────

type Scope = 'global' | 'project'

interface State {
  scope: Scope
  localProjectId: string | null
  skills: SkillInfo[]
  selectedPath: string | null
  detail: SkillDetail | null
  loading: boolean
  creating: boolean
  newName: string
  newDesc: string
  deleteConfirmPath: string | null
}

type Action =
  | { type: 'setScope'; scope: Scope }
  | { type: 'setLocalProject'; id: string | null }
  | { type: 'setSkills'; skills: SkillInfo[] }
  | { type: 'selectSkill'; path: string | null }
  | { type: 'setDetail'; detail: SkillDetail | null }
  | { type: 'setLoading'; loading: boolean }
  | { type: 'startCreate' }
  | { type: 'cancelCreate' }
  | { type: 'setNewName'; value: string }
  | { type: 'setNewDesc'; value: string }
  | { type: 'confirmDelete'; path: string }
  | { type: 'cancelDelete' }
  | { type: 'updateField'; field: keyof SkillDetail; value: string | boolean }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'setScope': return { ...state, scope: action.scope, selectedPath: null, detail: null }
    case 'setLocalProject': return { ...state, localProjectId: action.id, skills: [], selectedPath: null, detail: null }
    case 'setSkills': return { ...state, skills: action.skills }
    case 'selectSkill': return { ...state, selectedPath: action.path, detail: null }
    case 'setDetail': return { ...state, detail: action.detail }
    case 'setLoading': return { ...state, loading: action.loading }
    case 'startCreate': return { ...state, creating: true, newName: '', newDesc: '' }
    case 'cancelCreate': return { ...state, creating: false }
    case 'setNewName': return { ...state, newName: action.value }
    case 'setNewDesc': return { ...state, newDesc: action.value }
    case 'confirmDelete': return { ...state, deleteConfirmPath: action.path }
    case 'cancelDelete': return { ...state, deleteConfirmPath: null }
    case 'updateField':
      return state.detail ? { ...state, detail: { ...state.detail, [action.field]: action.value } } : state
  }
}

const VALID_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/

// ── Component ────────────────────────────────────────────────────────────────

export function SettingsClaudeSkills() {
  const { t } = useTranslation('settings')
  const projects = useProjectsStore((s) => s.projects)

  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    scope: 'global' as Scope,
    localProjectId: useUIStore.getState().selectedProjectId ?? null,
    skills: [] as SkillInfo[],
    selectedPath: null,
    detail: null,
    loading: true,
    creating: false,
    newName: '',
    newDesc: '',
    deleteConfirmPath: null,
  }))

  const stateRef = useRef(state)
  stateRef.current = state

  const projectsRef = useRef(projects)
  projectsRef.current = projects

  // Monaco theme
  const monacoInstance = useMonaco()
  const { activeThemeId, customThemes } = useUIStore(
    useShallow((s) => ({ activeThemeId: s.activeThemeId, customThemes: s.customThemes }))
  )
  const activePalette = useMemo(
    () => [...builtinThemes, ...customThemes].find((p) => p.id === activeThemeId) ?? builtinThemes[0],
    [activeThemeId, customThemes]
  )
  useEffect(() => {
    if (!monacoInstance) return
    monacoInstance.editor.defineTheme(MONACO_THEME_NAME, buildMonacoTheme(activePalette))
    monacoInstance.editor.setTheme(MONACO_THEME_NAME)
  }, [monacoInstance, activePalette])

  // Load skills
  const loadSkills = useCallback(() => {
    const { scope, localProjectId } = stateRef.current
    const projectPath = scope === 'project'
      ? projectsRef.current.find((p) => p.id === localProjectId)?.path
      : undefined
    dispatch({ type: 'setLoading', loading: true })
    ipc.claudeConfig.getSkills(projectPath)
      .then((skills) => {
        const scoped = skills.filter((s) => s.scope === stateRef.current.scope)
        dispatch({ type: 'setSkills', skills: scoped })
      })
      .finally(() => dispatch({ type: 'setLoading', loading: false }))
  }, [])

  useEffect(() => { loadSkills() }, [state.scope, state.localProjectId, loadSkills])

  // Load detail when selected
  useEffect(() => {
    if (!state.selectedPath) return
    ipc.claudeConfig.getSkillDetail(state.selectedPath)
      .then((detail) => dispatch({ type: 'setDetail', detail }))
  }, [state.selectedPath])

  // Debounced save
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }, [])

  const saveDetail = useCallback(() => {
    const { selectedPath, detail } = stateRef.current
    if (!selectedPath || !detail) return
    ipc.claudeConfig.setSkillDetail(selectedPath, detail).catch(console.error)
  }, [])

  const updateField = useCallback((field: keyof SkillDetail, value: string | boolean) => {
    dispatch({ type: 'updateField', field, value })
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(saveDetail, 500)
  }, [saveDetail])

  const handleBodyChange = useCallback((value: string | undefined) => {
    updateField('body', value ?? '')
  }, [updateField])

  // Create skill
  const handleCreate = useCallback(() => {
    const { newName, newDesc, scope, localProjectId } = stateRef.current
    if (!newName.trim() || !VALID_NAME.test(newName.trim())) return
    const projectPath = scope === 'project'
      ? projectsRef.current.find((p) => p.id === localProjectId)?.path
      : undefined
    ipc.claudeConfig.createSkill(scope, newName.trim(), newDesc.trim(), projectPath)
      .then((info) => {
        dispatch({ type: 'cancelCreate' })
        loadSkills()
        dispatch({ type: 'selectSkill', path: info.path })
      })
  }, [loadSkills])

  // Delete skill
  const handleDelete = useCallback(() => {
    const path = stateRef.current.deleteConfirmPath
    if (!path) return
    ipc.claudeConfig.deleteSkill(path).then(() => {
      dispatch({ type: 'cancelDelete' })
      if (stateRef.current.selectedPath === path) {
        dispatch({ type: 'selectSkill', path: null })
      }
      loadSkills()
    })
  }, [loadSkills])

  const filteredSkills = state.skills
  const localProject = projects.find((p) => p.id === state.localProjectId)
  const showProjectEmpty = state.scope === 'project' && !localProject

  return (
    <div className="settings-section">
      <div className="settings-field">
        <label className="settings-label">{t('claudeSkills.title')}</label>
        <span className="settings-hint">{t('claudeSkills.hint')}</span>
      </div>

      <SegmentedControl
        options={[
          { value: 'global' as Scope, label: t('claudeSkills.global') },
          { value: 'project' as Scope, label: t('claudeSkills.project') },
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
        <p className="settings-empty-state">{t('claudeSkills.selectProject')}</p>
      ) : (
        <>
          {/* Skill list */}
          <div className="settings-skill-list">
            {filteredSkills.length === 0 && !state.loading && (
              <span className="settings-empty-state">{t('claudeSkills.noSkills')}</span>
            )}
            {filteredSkills.map((skill) => (
              <div
                key={skill.path}
                className={`settings-skill-row${state.selectedPath === skill.path ? ' settings-skill-row--active' : ''}`}
                onClick={() => dispatch({ type: 'selectSkill', path: skill.path })}
              >
                <div className="settings-skill-info">
                  <span className="settings-skill-name">{skill.name}</span>
                  {skill.description && <span className="settings-skill-desc">{skill.description}</span>}
                </div>
                <span className="settings-skill-badge">/{skill.name}</span>
                {state.deleteConfirmPath === skill.path ? (
                  <div className="settings-skill-confirm" onClick={(e) => e.stopPropagation()}>
                    <button className="btn btn-danger btn--sm" onClick={handleDelete}>{t('claudeSkills.delete')}</button>
                    <button className="btn btn--sm" onClick={() => dispatch({ type: 'cancelDelete' })}>{t('claudeSkills.cancel')}</button>
                  </div>
                ) : (
                  <button
                    className="settings-skill-delete-btn"
                    onClick={(e) => { e.stopPropagation(); dispatch({ type: 'confirmDelete', path: skill.path }) }}
                  >
                    &times;
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Create form */}
          {state.creating ? (
            <div className="settings-skill-create-row">
              <input
                className={`settings-input${state.newName && !VALID_NAME.test(state.newName) ? ' settings-input--error' : ''}`}
                type="text"
                value={state.newName}
                placeholder={t('claudeSkills.namePlaceholder')}
                onChange={(e) => dispatch({ type: 'setNewName', value: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                autoFocus
              />
              <input
                className="settings-input"
                type="text"
                value={state.newDesc}
                placeholder={t('claudeSkills.descriptionPlaceholder')}
                onChange={(e) => dispatch({ type: 'setNewDesc', value: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              />
              <button className="btn btn-primary" onClick={handleCreate} disabled={!state.newName.trim() || !VALID_NAME.test(state.newName.trim())}>+</button>
              <button className="btn" onClick={() => dispatch({ type: 'cancelCreate' })}>&times;</button>
            </div>
          ) : (
            <button className="settings-hook-add-btn" onClick={() => dispatch({ type: 'startCreate' })}>
              + {t('claudeSkills.createSkill')}
            </button>
          )}

          {/* Skill editor */}
          {state.detail && state.selectedPath && (
            <div className="settings-skill-editor">
              <div className="settings-skill-form">
                <div className="settings-field">
                  <label className="settings-label">{t('claudeSkills.description')}</label>
                  <input
                    className="settings-input"
                    type="text"
                    value={state.detail.description}
                    onChange={(e) => dispatch({ type: 'updateField', field: 'description', value: e.target.value })}
                    onBlur={() => saveDetail()}
                  />
                </div>

                <div className="settings-field">
                  <label className="settings-label">{t('claudeSkills.argumentHint')}</label>
                  <input
                    className="settings-input"
                    type="text"
                    value={state.detail.argumentHint}
                    placeholder={t('claudeSkills.argumentHintPlaceholder')}
                    onChange={(e) => dispatch({ type: 'updateField', field: 'argumentHint', value: e.target.value })}
                    onBlur={() => saveDetail()}
                  />
                </div>

                <div className="settings-field">
                  <label className="settings-label">{t('claudeSkills.allowedTools')}</label>
                  <input
                    className="settings-input"
                    type="text"
                    value={state.detail.allowedTools}
                    placeholder={t('claudeSkills.allowedToolsPlaceholder')}
                    onChange={(e) => dispatch({ type: 'updateField', field: 'allowedTools', value: e.target.value })}
                    onBlur={() => saveDetail()}
                  />
                </div>

                <div className="settings-field settings-field--row">
                  <div>
                    <label className="settings-label">{t('claudeSkills.disableModelInvocation')}</label>
                    <span className="settings-hint">{t('claudeSkills.disableModelInvocationHint')}</span>
                  </div>
                  <Toggle
                    checked={state.detail.disableModelInvocation}
                    onChange={(v) => updateField('disableModelInvocation', v)}
                  />
                </div>

                <div className="settings-field">
                  <label className="settings-label">{t('claudeSkills.instructions')}</label>
                  <div className="settings-claude-editor" style={{ height: 280 }}>
                    <Editor
                      height="100%"
                      language="markdown"
                      value={state.detail.body}
                      theme={MONACO_THEME_NAME}
                      onChange={handleBodyChange}
                      options={SETTINGS_EDITOR_OPTIONS}
                      loading=""
                    />
                  </div>
                </div>

                {state.detail.additionalFiles.length > 0 && (
                  <div className="settings-field">
                    <label className="settings-label">{t('claudeSkills.additionalFiles')}</label>
                    <div className="settings-skill-files">
                      {state.detail.additionalFiles.map((f) => (
                        <span key={f} className="settings-plugin-badge">{f}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
