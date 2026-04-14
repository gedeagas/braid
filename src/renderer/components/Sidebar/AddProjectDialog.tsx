import { useMemo, useReducer } from 'react'
import { useProjectsStore } from '@/store/projects'
import { useUIStore } from '@/store/ui'
import * as ipc from '@/lib/ipc'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { IconGridFill, IconGitHub } from '@/components/shared/icons'
import { Dialog, Button, Spinner, Checkbox } from '@/components/ui'

// ── Types ────────────────────────────────────────────────────────────────────

type Tab = 'local' | 'github'

type DialogPhase =
  | { kind: 'idle' }
  | { kind: 'scanning' }
  | { kind: 'picker'; repos: string[] }
  | { kind: 'adding' }

interface State {
  tab: Tab
  localPath: string
  githubUrl: string
  phase: DialogPhase
  selectedRepos: Set<string>
  error: string
  cloning: boolean
}

type Action =
  | { type: 'setTab'; tab: Tab }
  | { type: 'setLocalPath'; value: string }
  | { type: 'setGithubUrl'; value: string }
  | { type: 'setError'; error: string }
  | { type: 'startScanning' }
  | { type: 'showPicker'; repos: string[]; alreadyAdded: Set<string> }
  | { type: 'resetToIdle' }
  | { type: 'toggleRepo'; path: string }
  | { type: 'startAdding' }
  | { type: 'startCloning' }
  | { type: 'cloneDone' }

const initialState: State = {
  tab: 'local',
  localPath: '',
  githubUrl: '',
  phase: { kind: 'idle' },
  selectedRepos: new Set(),
  error: '',
  cloning: false,
}

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'setTab':
      return { ...s, tab: a.tab, error: '' }
    case 'setLocalPath':
      return { ...s, localPath: a.value, error: '', phase: { kind: 'idle' }, selectedRepos: new Set() }
    case 'setGithubUrl':
      return { ...s, githubUrl: a.value, error: '' }
    case 'setError':
      return { ...s, error: a.error }
    case 'startScanning':
      return { ...s, phase: { kind: 'scanning' }, error: '' }
    case 'showPicker': {
      const selectable = a.repos.filter((r) => !a.alreadyAdded.has(r))
      return { ...s, phase: { kind: 'picker', repos: a.repos }, selectedRepos: new Set(selectable), error: '' }
    }
    case 'resetToIdle':
      return { ...s, phase: { kind: 'idle' } }
    case 'toggleRepo': {
      const next = new Set(s.selectedRepos)
      if (next.has(a.path)) next.delete(a.path)
      else next.add(a.path)
      return { ...s, selectedRepos: next }
    }
    case 'startAdding':
      return { ...s, phase: { kind: 'adding' } }
    case 'startCloning':
      return { ...s, cloning: true, error: '' }
    case 'cloneDone':
      return { ...s, cloning: false }
    default:
      return s
  }
}

// ── URL helpers ──────────────────────────────────────────────────────────────

/** Normalize a GitHub URL to a canonical clone URL, or return null if invalid. */
function normalizeGitHubUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(/\/+$/, '')

  // SSH: git@github.com:owner/repo[.git]
  const sshMatch = trimmed.match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/)
  if (sshMatch) return `git@github.com:${sshMatch[1]}/${sshMatch[2]}.git`

  // HTTPS: https://github.com/owner/repo[.git][/tree/branch/...]
  const httpsMatch = trimmed.match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s.]+)(?:\.git)?(?:\/.*)?$/)
  if (httpsMatch) return `https://github.com/${httpsMatch[1]}/${httpsMatch[2]}.git`

  return null
}

/** Extract "owner/repo" slug from a normalized GitHub URL. */
function extractRepoSlug(normalizedUrl: string): string {
  const sshMatch = normalizedUrl.match(/^git@github\.com:(.+?)(?:\.git)?$/)
  if (sshMatch) return sshMatch[1]
  const httpsMatch = normalizedUrl.match(/github\.com\/(.+?)(?:\.git)?$/)
  if (httpsMatch) return httpsMatch[1]
  return normalizedUrl
}

// ── Component ────────────────────────────────────────────────────────────────

export function AddProjectDialog() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const addProject = useProjectsStore((s) => s.addProject)
  const setShowAddProject = useUIStore((s) => s.setShowAddProject)
  const projects = useProjectsStore(useShallow((s) => s.projects))
  const existingPaths = useMemo(() => new Set(projects.map((p) => p.path)), [projects])
  const existingRemoteOrigins = useMemo(
    () => projects.map((p) => ({ name: p.name, origin: p.settings?.remoteOrigin ?? '' })),
    [projects],
  )
  const { t } = useTranslation('sidebar')

  const isBusy = state.phase.kind === 'scanning' || state.phase.kind === 'adding' || state.cloning
  const isPicker = state.phase.kind === 'picker'

  // ── Local path handlers ───────────────────────────────────────────────────

  const handleBrowse = async () => {
    const selected = await ipc.dialog.openDirectory()
    if (selected) dispatch({ type: 'setLocalPath', value: selected })
  }

  const handleAdd = async () => {
    const path = state.localPath.trim()
    if (!path) {
      dispatch({ type: 'setError', error: t('addProjectSelectDirError') })
      return
    }
    dispatch({ type: 'startScanning' })
    try {
      const isRoot = await ipc.git.isRepoRoot(path)
      if (isRoot) {
        if (existingPaths.has(path)) {
          dispatch({ type: 'setError', error: t('projectAlreadyAdded') })
          dispatch({ type: 'resetToIdle' })
          return
        }
        dispatch({ type: 'startAdding' })
        await addProject(path)
        setShowAddProject(false)
        return
      }
      const children = await ipc.git.findChildRepos(path)
      if (children.length === 0) {
        dispatch({ type: 'setError', error: t('noReposFound') })
        dispatch({ type: 'resetToIdle' })
        return
      }
      const allAdded = children.every((r) => existingPaths.has(r))
      if (allAdded) {
        dispatch({ type: 'setError', error: t('allReposAlreadyAdded') })
        dispatch({ type: 'resetToIdle' })
        return
      }
      dispatch({ type: 'showPicker', repos: children, alreadyAdded: existingPaths })
    } catch {
      dispatch({ type: 'setError', error: t('addProjectInvalidRepoError') })
      dispatch({ type: 'resetToIdle' })
    }
  }

  const handleAddSelected = async () => {
    dispatch({ type: 'startAdding' })
    try {
      for (const repoPath of state.selectedRepos) {
        await addProject(repoPath)
      }
      setShowAddProject(false)
    } catch {
      dispatch({ type: 'setError', error: t('addProjectInvalidRepoError') })
      dispatch({ type: 'resetToIdle' })
    }
  }

  // ── GitHub handlers ───────────────────────────────────────────────────────

  const handleCloneAndAdd = async () => {
    const url = state.githubUrl.trim()
    if (!url) {
      dispatch({ type: 'setError', error: t('githubUrlEmptyError') })
      return
    }
    const normalized = normalizeGitHubUrl(url)
    if (!normalized) {
      dispatch({ type: 'setError', error: t('githubUrlInvalidError') })
      return
    }

    // Check for duplicate — compare against existing project remote origins
    const slug = extractRepoSlug(normalized)
    const duplicate = existingRemoteOrigins.find((p) => {
      if (!p.origin) return false
      const existingNorm = normalizeGitHubUrl(p.origin)
      return existingNorm ? extractRepoSlug(existingNorm) === slug : false
    })
    if (duplicate) {
      dispatch({ type: 'setError', error: t('githubRepoDuplicateWarning', { name: duplicate.name }) })
      return
    }

    dispatch({ type: 'startCloning' })
    let clonedPath: string
    try {
      clonedPath = await ipc.git.cloneRepo(normalized)
    } catch (err: unknown) {
      dispatch({ type: 'cloneDone' })
      const code = (err as { code?: string })?.code
      const key = code && ['auth', 'not_found', 'network', 'disk'].includes(code)
        ? `githubCloneError_${code}`
        : 'githubCloneError_unknown'
      dispatch({ type: 'setError', error: t(key) })
      return
    }
    dispatch({ type: 'cloneDone' })
    try {
      await addProject(clonedPath)
      setShowAddProject(false)
    } catch {
      dispatch({ type: 'setError', error: t('githubCloneAddedError') })
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const pickerRepos = isPicker ? (state.phase as { kind: 'picker'; repos: string[] }).repos : []
  const primaryAction = state.tab === 'github' ? handleCloneAndAdd : isPicker ? handleAddSelected : handleAdd
  const primaryLabel = state.tab === 'github'
    ? t('cloneAndAdd')
    : isPicker
      ? t('addReposButton', { count: state.selectedRepos.size })
      : t('add', { ns: 'common' })
  const primaryDisabled = isBusy || (isPicker && state.selectedRepos.size === 0)

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Dialog
      isOpen
      onClose={() => setShowAddProject(false)}
      title={t('addProjectTitle')}
      actions={
        state.phase.kind === 'scanning' ? undefined : (
          <>
            <Button onClick={() => setShowAddProject(false)} disabled={isBusy}>
              {t('cancel', { ns: 'common' })}
            </Button>
            <Button variant="primary" onClick={primaryAction} disabled={primaryDisabled}>
              {primaryLabel}
            </Button>
          </>
        )
      }
    >
      {/* Tab switcher */}
      <div className="dialog-tabs">
        <button
          className={`dialog-tab${state.tab === 'local' ? ' dialog-tab--active' : ''}`}
          onClick={() => dispatch({ type: 'setTab', tab: 'local' })}
          disabled={isBusy}
        >
          <IconGridFill />
          {t('localPathTab')}
        </button>
        <button
          className={`dialog-tab${state.tab === 'github' ? ' dialog-tab--active' : ''}`}
          onClick={() => dispatch({ type: 'setTab', tab: 'github' })}
          disabled={isBusy}
        >
          <IconGitHub />
          {t('githubUrlTab')}
        </button>
      </div>

      {/* Local tab */}
      {state.tab === 'local' && (
        <>
          <div className="dialog-field">
            <label>{t('repoPathLabel')}</label>
            <div className="dialog-input-row">
              <input
                value={state.localPath}
                onChange={(e) => dispatch({ type: 'setLocalPath', value: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter' && state.phase.kind === 'idle') handleAdd() }}
                placeholder={t('repoPathPlaceholder')}
                disabled={state.phase.kind !== 'idle'}
                autoFocus
              />
              <Button onClick={handleBrowse} disabled={state.phase.kind !== 'idle'}>
                {t('browse', { ns: 'common' })}
              </Button>
            </div>
          </div>

          {/* Repo picker */}
          {isPicker && pickerRepos.length > 0 && (
            <div className="dialog-field">
              <div className="dialog-found-header">
                {t('foundReposHeader', { count: pickerRepos.length })}
                <span className="dialog-found-hint">{t('selectReposHint')}</span>
              </div>
              <div className="dialog-repo-list">
                {pickerRepos.map((repoPath) => {
                  const name = repoPath.split('/').pop() ?? repoPath
                  const parentBase = state.localPath.replace(/\/+$/, '')
                  const rel = repoPath.startsWith(parentBase + '/')
                    ? repoPath.slice(parentBase.length + 1)
                    : repoPath
                  const alreadyAdded = existingPaths.has(repoPath)
                  return (
                    <label
                      key={repoPath}
                      className={`dialog-repo-item${alreadyAdded ? ' dialog-repo-item--already' : ''}`}
                    >
                      <Checkbox
                        checked={state.selectedRepos.has(repoPath)}
                        disabled={alreadyAdded}
                        onChange={() => dispatch({ type: 'toggleRepo', path: repoPath })}
                      />
                      <span className="dialog-repo-item__name">{name}</span>
                      <span className="dialog-repo-item__path">{rel}</span>
                      {alreadyAdded && (
                        <span className="dialog-repo-badge">{t('alreadyAdded')}</span>
                      )}
                    </label>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* GitHub tab */}
      {state.tab === 'github' && (
        <div className="dialog-field">
          <label>{t('githubUrlLabel')}</label>
          <input
            value={state.githubUrl}
            onChange={(e) => dispatch({ type: 'setGithubUrl', value: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter' && !state.cloning) handleCloneAndAdd() }}
            placeholder={t('githubUrlPlaceholder')}
            disabled={state.cloning}
            autoFocus
          />
          {state.cloning && (
            <div className="dialog-clone-progress">
              <Spinner size="sm" />
              {t('cloningRepository')}
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {state.error && <div className="dialog-error">{state.error}</div>}

      {/* Scanning state */}
      {state.phase.kind === 'scanning' && (
        <div className="dialog-clone-progress">
          <Spinner size="sm" />
          {t('scanningDirectory')}
        </div>
      )}
    </Dialog>
  )
}
