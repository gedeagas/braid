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
import { ProjectPillDropdown } from '@/components/shared/ProjectPillDropdown'
import { SegmentedControl } from '@/components/shared/SegmentedControl'
import { SETTINGS_EDITOR_OPTIONS } from './editorOptions'

// ── Reducer ──────────────────────────────────────────────────────────────────

type Scope = 'global' | 'project'

interface State {
  scope: Scope
  localProjectId: string | null
  globalContent: string
  projectContent: string
  loading: boolean
}

type Action =
  | { type: 'setScope'; scope: Scope }
  | { type: 'setLocalProject'; id: string | null }
  | { type: 'setGlobalContent'; content: string }
  | { type: 'setProjectContent'; content: string }
  | { type: 'setLoading'; loading: boolean }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'setScope': return { ...state, scope: action.scope }
    case 'setLocalProject': return { ...state, localProjectId: action.id, projectContent: '' }
    case 'setGlobalContent': return { ...state, globalContent: action.content }
    case 'setProjectContent': return { ...state, projectContent: action.content }
    case 'setLoading': return { ...state, loading: action.loading }
  }
}

// ── Component ────────────────────────────────────────────────────────────────

export function SettingsClaudeInstructions() {
  const { t } = useTranslation('settings')
  const projects = useProjectsStore((s) => s.projects)

  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    scope: 'global' as Scope,
    localProjectId: useUIStore.getState().selectedProjectId ?? null,
    globalContent: '',
    projectContent: '',
    loading: true,
  }))

  // Monaco theme sync
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

  // Load content
  useEffect(() => {
    dispatch({ type: 'setLoading', loading: true })
    ipc.claudeConfig.getGlobalInstructions()
      .then((content) => dispatch({ type: 'setGlobalContent', content }))
      .finally(() => dispatch({ type: 'setLoading', loading: false }))
  }, [])

  const projectsRef = useRef(projects)
  projectsRef.current = projects

  useEffect(() => {
    const project = projectsRef.current.find((p) => p.id === state.localProjectId)
    if (!project) return
    ipc.claudeConfig.getProjectInstructions(project.path)
      .then((content) => dispatch({ type: 'setProjectContent', content }))
  }, [state.localProjectId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced save
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
  }, [])

  const handleChange = useCallback((value: string | undefined) => {
    const v = value ?? ''
    const { scope } = stateRef.current
    if (scope === 'global') {
      dispatch({ type: 'setGlobalContent', content: v })
    } else {
      dispatch({ type: 'setProjectContent', content: v })
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      const currentScope = stateRef.current.scope
      if (currentScope === 'global') {
        ipc.claudeConfig.setGlobalInstructions(v)
      } else {
        const project = projectsRef.current.find((p) => p.id === stateRef.current.localProjectId)
        if (project) {
          ipc.claudeConfig.setProjectInstructions(project.path, v)
        }
      }
    }, 300)
  }, [])

  const content = state.scope === 'global' ? state.globalContent : state.projectContent
  const localProject = projects.find((p) => p.id === state.localProjectId)
  const showProjectEmpty = state.scope === 'project' && !localProject

  return (
    <div className="settings-section">
      <div className="settings-field">
        <label className="settings-label">{t('claudeInstructions.title')}</label>
        <span className="settings-hint">{t('claudeInstructions.hint')}</span>
      </div>

      <SegmentedControl
        options={[
          { value: 'global' as Scope, label: t('claudeInstructions.global') },
          { value: 'project' as Scope, label: t('claudeInstructions.project') },
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
        <p className="settings-empty-state">{t('claudeInstructions.selectProject')}</p>
      ) : (
        <>
          <div className="settings-claude-editor" style={{ height: 360 }}>
            <Editor
              height="100%"
              language="markdown"
              value={content}
              theme={MONACO_THEME_NAME}
              onChange={handleChange}
              options={SETTINGS_EDITOR_OPTIONS}
              loading=""
            />
          </div>
          <span className="settings-hint" style={{ fontFamily: 'var(--font-mono)' }}>
            {state.scope === 'global'
              ? t('claudeInstructions.globalPath')
              : localProject?.path ? `${localProject.path}/CLAUDE.md` : ''
            }
          </span>
        </>
      )}
    </div>
  )
}
