import { useEffect } from 'react'
import * as ipc from '@/lib/ipc'
import { useTranslation } from 'react-i18next'
import { Button, Spinner, Checkbox } from '@/components/ui'
import type { State, Action } from './types'

interface Props {
  state: State
  dispatch: React.Dispatch<Action>
  existingPaths: Set<string>
  addProject: (path: string) => Promise<void>
  onClose: () => void
  onActionRef: React.MutableRefObject<(() => void) | null>
}

export function LocalTab({ state, dispatch, existingPaths, addProject, onClose, onActionRef }: Props) {
  const { t } = useTranslation('sidebar')
  const isPicker = state.phase.kind === 'picker'
  const pickerRepos = isPicker ? (state.phase as { kind: 'picker'; repos: string[] }).repos : []

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
        onClose()
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

  useEffect(() => {
    onActionRef.current = handleAdd
    return () => { onActionRef.current = null }
  })

  return (
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

      {state.phase.kind === 'scanning' && (
        <div className="dialog-clone-progress">
          <Spinner size="sm" />
          {t('scanningDirectory')}
        </div>
      )}
    </>
  )
}
