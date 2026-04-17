import { useMemo, useReducer, useRef } from 'react'
import { useProjectsStore } from '@/store/projects'
import { useUIStore } from '@/store/ui'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { IconGridFill, IconGitHub, IconSparkle } from '@/components/shared/icons'
import { Dialog, Button } from '@/components/ui'
import { isValidProjectName } from '@shared/projectName'
import { reducer, initialState } from './types'
import type { Tab } from './types'
import { LocalTab } from './LocalTab'
import { GitHubTab } from './GitHubTab'
import { QuickStartTab } from './QuickStartTab'

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

  const actionRef = useRef<(() => void) | null>(null)
  const onClose = () => setShowAddProject(false)

  const isBusy = state.phase.kind === 'scanning' || state.phase.kind === 'adding' || state.cloning || state.creating
  const isPicker = state.phase.kind === 'picker'

  // ── Primary action per tab ─────────────────────────────────────────────────

  const handleAddSelected = async () => {
    dispatch({ type: 'startAdding' })
    try {
      for (const repoPath of state.selectedRepos) {
        await addProject(repoPath)
      }
      onClose()
    } catch {
      dispatch({ type: 'setError', error: t('addProjectInvalidRepoError') })
      dispatch({ type: 'resetToIdle' })
    }
  }

  const handlePrimaryClick = () => {
    if (isPicker) handleAddSelected()
    else actionRef.current?.()
  }

  const getPrimaryLabel = () => {
    if (state.tab === 'quickstart') return t('quickStartCreateButton')
    if (state.tab === 'github') return t('cloneAndAdd')
    if (isPicker) return t('addReposButton', { count: state.selectedRepos.size })
    return t('add', { ns: 'common' })
  }

  const primaryDisabled = isBusy || (isPicker && state.selectedRepos.size === 0)
    || (state.tab === 'quickstart' && !isValidProjectName(state.projectName.trim()))
    || (state.tab === 'quickstart' && !state.projectLocation.trim())

  // ── Tab config ─────────────────────────────────────────────────────────────

  const tabs: { id: Tab; icon: React.ReactNode; label: string }[] = [
    { id: 'local', icon: <IconGridFill />, label: t('localPathTab') },
    { id: 'github', icon: <IconGitHub />, label: t('githubUrlTab') },
    { id: 'quickstart', icon: <IconSparkle />, label: t('quickStartTab') },
  ]

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Dialog
      isOpen
      onClose={onClose}
      title={t('addProjectTitle')}
      className="dialog--add-project"
      actions={
        state.phase.kind === 'scanning' ? undefined : (
          <>
            <Button onClick={onClose} disabled={isBusy}>
              {t('cancel', { ns: 'common' })}
            </Button>
            <Button variant="primary" onClick={handlePrimaryClick} disabled={primaryDisabled}>
              {getPrimaryLabel()}
            </Button>
          </>
        )
      }
    >
      {/* Tab switcher */}
      <div className="dialog-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`dialog-tab${state.tab === tab.id ? ' dialog-tab--active' : ''}`}
            onClick={() => dispatch({ type: 'setTab', tab: tab.id })}
            disabled={isBusy}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {state.tab === 'quickstart' && (
        <QuickStartTab
          state={state}
          dispatch={dispatch}
          existingPaths={existingPaths}
          addProject={addProject}
          onClose={onClose}
          onActionRef={actionRef}
        />
      )}

      {state.tab === 'local' && (
        <LocalTab
          state={state}
          dispatch={dispatch}
          existingPaths={existingPaths}
          addProject={addProject}
          onClose={onClose}
          onActionRef={actionRef}
        />
      )}

      {state.tab === 'github' && (
        <GitHubTab
          state={state}
          dispatch={dispatch}
          existingRemoteOrigins={existingRemoteOrigins}
          addProject={addProject}
          onClose={onClose}
          onActionRef={actionRef}
        />
      )}

      {/* Error */}
      {state.error && <div className="dialog-error">{state.error}</div>}
    </Dialog>
  )
}
