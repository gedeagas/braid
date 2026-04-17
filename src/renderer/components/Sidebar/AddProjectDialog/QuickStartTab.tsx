import { useEffect } from 'react'
import * as ipc from '@/lib/ipc'
import { useTranslation } from 'react-i18next'
import { Button, Spinner } from '@/components/ui'
import { PROJECT_NAME_REGEX } from './types'
import type { State, Action } from './types'

interface Props {
  state: State
  dispatch: React.Dispatch<Action>
  existingPaths: Set<string>
  addProject: (path: string) => Promise<void>
  onClose: () => void
  onActionRef: React.MutableRefObject<(() => void) | null>
}

export function QuickStartTab({ state, dispatch, existingPaths, addProject, onClose, onActionRef }: Props) {
  const { t } = useTranslation('sidebar')

  const handleBrowseLocation = async () => {
    const selected = await ipc.dialog.openDirectory()
    if (selected) dispatch({ type: 'setProjectLocation', value: selected })
  }

  const handleCreate = async () => {
    const name = state.projectName.trim()
    if (!name) {
      dispatch({ type: 'setError', error: t('quickStartNameEmpty') })
      return
    }
    if (!PROJECT_NAME_REGEX.test(name)) {
      dispatch({ type: 'setError', error: t('quickStartNameInvalid') })
      return
    }
    const location = state.projectLocation.trim()
    if (!location) {
      dispatch({ type: 'setError', error: t('quickStartLocationEmpty') })
      return
    }
    const parentDir = location.replace(/\/+$/, '')
    const fullPath = `${parentDir}/${name}`
    const exists = await ipc.files.pathExists(fullPath)
    if (exists) {
      dispatch({ type: 'setError', error: t('quickStartPathExists') })
      return
    }
    if (existingPaths.has(fullPath)) {
      dispatch({ type: 'setError', error: t('projectAlreadyAdded') })
      return
    }

    dispatch({ type: 'startCreating' })
    try {
      if (state.selectedTemplate === 'nextjs') {
        // create-next-app scaffolds the project dir AND runs `git init`,
        // so we don't need ipc.git.initRepo for this template.
        const res = await ipc.templates.create('nextjs', { parentDir, projectName: name })
        if (!res.success) {
          dispatch({ type: 'setError', error: t('quickStartNextjsFailed') })
          dispatch({ type: 'doneCreating' })
          return
        }
      } else {
        await ipc.git.initRepo(fullPath)
      }
      await addProject(fullPath)
      onClose()
    } catch {
      dispatch({ type: 'setError', error: t('quickStartCreateFailed') })
      dispatch({ type: 'doneCreating' })
    }
  }

  useEffect(() => {
    onActionRef.current = handleCreate
    return () => { onActionRef.current = null }
  })

  return (
    <>
      <div className="dialog-field">
        <label>{t('quickStartNameLabel')}</label>
        <input
          value={state.projectName}
          onChange={(e) => dispatch({ type: 'setProjectName', value: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter' && !state.creating) handleCreate() }}
          placeholder={t('quickStartNamePlaceholder')}
          disabled={state.creating}
          autoFocus
        />
      </div>

      <div className="dialog-field">
        <label>{t('quickStartLocationLabel')}</label>
        <div className="dialog-input-row">
          <input
            value={state.projectLocation}
            onChange={(e) => dispatch({ type: 'setProjectLocation', value: e.target.value })}
            placeholder={t('quickStartLocationPlaceholder')}
            disabled={state.creating}
          />
          <Button onClick={handleBrowseLocation} disabled={state.creating}>
            {t('browse', { ns: 'common' })}
          </Button>
        </div>
      </div>

      <div className="dialog-field">
        <label>{t('quickStartTemplateLabel')}</label>
        <div className="template-grid">
          <button
            className={`template-card${state.selectedTemplate === 'empty' ? ' template-card--selected' : ''}`}
            onClick={() => dispatch({ type: 'setTemplate', value: 'empty' })}
            disabled={state.creating}
          >
            <span className="template-card__icon">📄</span>
            <span className="template-card__name">{t('quickStartTemplateEmpty')}</span>
          </button>
          <button
            className={`template-card${state.selectedTemplate === 'nextjs' ? ' template-card--selected' : ''}`}
            onClick={() => dispatch({ type: 'setTemplate', value: 'nextjs' })}
            disabled={state.creating}
          >
            <span className="template-card__icon">⚡</span>
            <span className="template-card__name">{t('quickStartTemplateNextjs')}</span>
          </button>
        </div>
      </div>

      {state.creating && (
        <div className="dialog-clone-progress">
          <Spinner size="sm" />
          {state.selectedTemplate === 'nextjs' ? t('quickStartCreatingNextjs') : t('quickStartCreating')}
        </div>
      )}
    </>
  )
}
