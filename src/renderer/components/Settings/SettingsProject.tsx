import { useReducer, useEffect, useCallback, useRef, useMemo } from 'react'
import Editor, { useMonaco } from '@monaco-editor/react'
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from 'react-i18next'
import { useProjectsStore, createDefaultProjectSettings } from '@/store/projects'
import { useUIStore } from '@/store/ui'
import { builtinThemes } from '@/themes/palettes'
import { buildMonacoTheme } from '@/themes/monaco'
import { MONACO_THEME_NAME } from '@/lib/appBrand'
import { OpenInDropdown } from '@/components/shared/OpenInDropdown'
import * as ipc from '@/lib/ipc'
import type { ProjectSettings } from '@/types'
import { SETTINGS_EDITOR_COMPACT } from './editorOptions'
import { SettingsRunScripts } from './SettingsRunScripts'
import { SettingsProjectLsp } from './SettingsProjectLsp'
import { SettingsProjectGitIdentity } from './SettingsProjectGitIdentity'
import { SettingsProjectCopyFiles } from './SettingsProjectCopyFiles'
import type { LspServerConfig } from '@/types'

// ── Reducer ──────────────────────────────────────────────────────────────────

interface GitRemote {
  name: string
  url: string
}

interface State {
  projectId: string | null
  workspacesPath: string
  defaultBaseBranch: string
  branchPrefix: string
  remoteOrigin: string
  setupScript: string
  runScript: string
  archiveScript: string
  copyFiles: string[]
  // Async-loaded data
  remoteBranches: string[]
  loadingBranches: boolean
  remotes: GitRemote[]
  loadingRemotes: boolean
}

type Action =
  | { type: 'loadProject'; projectId: string | null; settings: ProjectSettings }
  | { type: 'setField'; field: keyof ProjectSettings; value: string }
  | { type: 'setCopyFiles'; files: string[] }
  | { type: 'setRemoteBranches'; branches: string[]; loading: boolean }
  | { type: 'setRemotes'; remotes: GitRemote[]; loading: boolean }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'loadProject':
      return {
        ...state,
        ...action.settings,
        projectId: action.projectId,
        remoteBranches: [],
        loadingBranches: false,
        remotes: [],
        loadingRemotes: false,
      }
    case 'setField':
      return { ...state, [action.field]: action.value }
    case 'setCopyFiles':
      return { ...state, copyFiles: action.files }
    case 'setRemoteBranches':
      return { ...state, remoteBranches: action.branches, loadingBranches: action.loading }
    case 'setRemotes':
      return { ...state, remotes: action.remotes, loadingRemotes: action.loading }
  }
}

// ── Monaco script editor ─────────────────────────────────────────────────────

const LINE_HEIGHT = 19
const MIN_LINES = 3
const MAX_LINES = 10


interface ScriptEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder: string
}

function ScriptEditor({ value, onChange, placeholder }: ScriptEditorProps) {
  const lineCount = Math.max(MIN_LINES, Math.min(MAX_LINES, (value || '').split('\n').length + 1))
  const height = lineCount * LINE_HEIGHT + 16 // +16 for padding

  return (
    <div className="settings-script-editor" style={{ height }}>
      <Editor
        height="100%"
        language="shell"
        value={value}
        theme={MONACO_THEME_NAME}
        onChange={(v) => onChange(v ?? '')}
        options={SETTINGS_EDITOR_COMPACT}
        loading=""
      />
      {!value && (
        <div className="settings-script-placeholder">{placeholder}</div>
      )}
    </div>
  )
}

// ── Component ────────────────────────────────────────────────────────────────

interface Props {
  projectId: string
}

export function SettingsProject({ projectId }: Props) {
  const { t } = useTranslation('settings')
  const project = useProjectsStore((s) => s.projects.find((p) => p.id === projectId))
  const updateProjectSettings = useProjectsStore((s) => s.updateProjectSettings)

  const [state, dispatch] = useReducer(reducer, {
    projectId: null,
    ...createDefaultProjectSettings(),
    remoteBranches: [],
    loadingBranches: false,
    remotes: [],
    loadingRemotes: false,
  })

  // Apply theme to Monaco
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

  // Load settings when project changes
  useEffect(() => {
    if (!project) return
    dispatch({
      type: 'loadProject',
      projectId: project.id,
      settings: project.settings ?? createDefaultProjectSettings()
    })
  }, [project?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const stateRef = useRef(state)
  stateRef.current = state

  // Debounced save for Monaco editors
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const save = useCallback((partial: Partial<ProjectSettings>) => {
    const pid = stateRef.current.projectId
    if (!pid) return
    updateProjectSettings(pid, partial)
  }, [updateProjectSettings])

  const debouncedSave = useCallback((field: keyof ProjectSettings, value: string) => {
    dispatch({ type: 'setField', field, value })
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      save({ [field]: value })
    }, 300)
  }, [save])

  // Cleanup debounce timer
  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
  }, [])

  // Fetch remote branches for the base branch dropdown
  useEffect(() => {
    if (!project) return
    dispatch({ type: 'setRemoteBranches', branches: [], loading: true })
    ipc.git.getRemoteBranches(project.path)
      .then(({ branches }) => dispatch({ type: 'setRemoteBranches', branches, loading: false }))
      .catch(() => dispatch({ type: 'setRemoteBranches', branches: [], loading: false }))
  }, [project?.path]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch git remotes for the remote origin dropdown
  useEffect(() => {
    if (!project) return
    dispatch({ type: 'setRemotes', remotes: [], loading: true })
    ipc.git.getRemotes(project.path)
      .then((remotes: Array<{ name: string; url: string }>) => {
        dispatch({ type: 'setRemotes', remotes, loading: false })
        // Auto-select origin if remoteOrigin is empty
        if (!stateRef.current.remoteOrigin && remotes.length > 0) {
          const origin = remotes.find((r: { name: string }) => r.name === 'origin')
          const defaultRemote = origin ?? remotes[0]
          dispatch({ type: 'setField', field: 'remoteOrigin', value: defaultRemote.name })
          save({ remoteOrigin: defaultRemote.name })
        }
      })
      .catch(() => dispatch({ type: 'setRemotes', remotes: [], loading: false }))
  }, [project?.path]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!project) {
    return (
      <div className="settings-section">
        <p style={{ color: 'var(--text-muted)' }}>{t('project.noProject')}</p>
      </div>
    )
  }

  const handleRunScript = () => {
    const script = stateRef.current.runScript?.trim()
    if (!script) return
    const ui = useUIStore.getState()
    const wt = project.worktrees.find((w) => w.id === ui.selectedWorktreeId)
    if (!wt) return
    ui.setPendingTerminalCommand({
      worktreePath: wt.path,
      label: 'Run Script',
      command: script
    })
    ui.closeSettings()
  }

  const handleBrowseWorkspacesPath = async () => {
    const dir = await ipc.dialog.openDirectory()
    if (dir) {
      dispatch({ type: 'setField', field: 'workspacesPath', value: dir })
      save({ workspacesPath: dir })
    }
  }

  return (
    <div className="settings-section">
      {/* Project header */}
      <div className="settings-project-header">
        <span className="settings-project-name">{project.name}</span>
        <div className="settings-path-row">
          <span className="settings-project-path">{project.path}</span>
          <OpenInDropdown path={project.path} />
        </div>
      </div>

      {/* Worktree settings */}
      <div className="settings-card">
        <div className="settings-field">
          <label className="settings-label">{t('project.workspacesPath')}</label>
          <span className="settings-hint">{t('project.workspacesPathHint')}</span>
          <div className="settings-path-row">
            <span className={`settings-path-display${!state.workspacesPath ? ' placeholder' : ''}`}>
              {state.workspacesPath || '~/Braid/worktrees/'}
            </span>
            <button className="settings-browse-btn" onClick={handleBrowseWorkspacesPath}>
              {t('project.browse')}
            </button>
            {state.workspacesPath && <OpenInDropdown path={state.workspacesPath} />}
          </div>
        </div>

        <div className="settings-field">
          <label className="settings-label">{t('project.defaultBaseBranch')}</label>
          <span className="settings-hint">{t('project.defaultBaseBranchHint')}</span>
          <select
            className="settings-select"
            value={state.defaultBaseBranch}
            onChange={(e) => {
              dispatch({ type: 'setField', field: 'defaultBaseBranch', value: e.target.value })
              save({ defaultBaseBranch: e.target.value })
            }}
            disabled={state.loadingBranches}
          >
            <option value="">
              {state.loadingBranches ? t('project.loadingBranches') : t('project.selectBranch')}
            </option>
            {state.remoteBranches.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
            {state.defaultBaseBranch && !state.remoteBranches.includes(state.defaultBaseBranch) && (
              <option value={state.defaultBaseBranch}>{state.defaultBaseBranch}</option>
            )}
          </select>
        </div>

        <div className="settings-field">
          <label className="settings-label">{t('project.branchPrefix')}</label>
          <span className="settings-hint">{t('project.branchPrefixHint')}</span>
          <input
            className="settings-input"
            type="text"
            value={state.branchPrefix}
            placeholder="feat/"
            onChange={(e) => dispatch({ type: 'setField', field: 'branchPrefix', value: e.target.value })}
            onBlur={() => save({ branchPrefix: stateRef.current.branchPrefix })}
          />
        </div>

        <div className="settings-field">
          <label className="settings-label">{t('project.remoteOrigin')}</label>
          <span className="settings-hint">{t('project.remoteOriginHint')}</span>
          {state.remotes.length > 0 ? (
            <select
              className="settings-input"
              value={state.remoteOrigin}
              onChange={(e) => {
                dispatch({ type: 'setField', field: 'remoteOrigin', value: e.target.value })
                save({ remoteOrigin: e.target.value })
              }}
            >
              {state.remotes.map((r) => (
                <option key={r.name} value={r.name}>
                  {r.name} ({r.url})
                </option>
              ))}
              {state.remoteOrigin && !state.remotes.some((r) => r.name === state.remoteOrigin) && (
                <option value={state.remoteOrigin}>{state.remoteOrigin}</option>
              )}
            </select>
          ) : (
            <input
              className="settings-input"
              type="text"
              value={state.remoteOrigin}
              placeholder={state.loadingRemotes ? t('project.loadingBranches') : 'origin'}
              onChange={(e) => dispatch({ type: 'setField', field: 'remoteOrigin', value: e.target.value })}
              onBlur={() => save({ remoteOrigin: stateRef.current.remoteOrigin })}
              disabled={state.loadingRemotes}
            />
          )}
        </div>
      </div>

      {/* Git Identity */}
      <SettingsProjectGitIdentity projectPath={project.path} />

      {/* Copy Files */}
      <SettingsProjectCopyFiles
        projectPath={project.path}
        copyFiles={state.copyFiles}
        onUpdate={(files) => {
          dispatch({ type: 'setCopyFiles', files })
          save({ copyFiles: files })
        }}
      />

      {/* Run Scripts — favorites & custom commands */}
      <SettingsRunScripts projectId={project.id} />

      {/* Lifecycle Scripts */}
      <div className="settings-card">
        <h3 className="settings-card-title">{t('project.scriptsHeader')}</h3>

        <div className="settings-field">
          <label className="settings-label">{t('project.setupScripts')}</label>
          <span className="settings-hint">{t('project.setupScriptsHint')}</span>
          <ScriptEditor
            value={state.setupScript}
            onChange={(v) => debouncedSave('setupScript', v)}
            placeholder="npm install\nnpx prisma generate"
          />
        </div>

        <div className="settings-field">
          <div className="settings-label-row">
            <label className="settings-label">{t('project.runScripts')}</label>
            <button
              className="settings-run-btn"
              onClick={handleRunScript}
              disabled={!state.runScript?.trim()}
            >
              ▶ {t('project.runButton')}
            </button>
          </div>
          <span className="settings-hint">{t('project.runScriptsHint')}</span>
          <ScriptEditor
            value={state.runScript}
            onChange={(v) => debouncedSave('runScript', v)}
            placeholder="npm run dev"
          />
        </div>

        <div className="settings-field">
          <label className="settings-label">{t('project.archiveScripts')}</label>
          <span className="settings-hint">{t('project.archiveScriptsHint')}</span>
          <ScriptEditor
            value={state.archiveScript}
            onChange={(v) => debouncedSave('archiveScript', v)}
            placeholder="rm -rf node_modules .next"
          />
        </div>
      </div>

      {/* Language Servers */}
      <div className="settings-card">
        {project && (
          <SettingsProjectLsp
            projectId={project.id}
            projectPath={project.path}
            lspDisabled={project.settings?.lspDisabled ?? false}
            lspServers={project.settings?.lspServers ?? []}
            onToggleDisabled={(disabled) => updateProjectSettings(project.id, { lspDisabled: disabled })}
            onUpdateServers={(servers: LspServerConfig[]) => updateProjectSettings(project.id, { lspServers: servers })}
          />
        )}
      </div>
    </div>
  )
}
