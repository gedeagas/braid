import { useEffect } from 'react'
import * as ipc from '@/lib/ipc'
import type { CreateTemplateFailureReason } from '@/lib/ipc'
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

/** Map a typed failure reason from the main process to an i18n key. */
function errorKeyFor(reason: CreateTemplateFailureReason): string | null {
  switch (reason) {
    case 'cancelled':
      return null // user-initiated; no error surface
    case 'invalid-name':
      return 'quickStartNameInvalid'
    case 'missing-parent':
      return 'quickStartLocationEmpty'
    case 'parent-not-directory':
      return 'quickStartParentNotDirectory'
    case 'tool-missing':
      return 'quickStartNextjsToolMissing'
    case 'timeout':
      return 'quickStartNextjsTimeout'
    case 'failed':
    default:
      return 'quickStartNextjsFailed'
  }
}

export function QuickStartTab({ state, dispatch, existingPaths, addProject, onClose, onActionRef }: Props) {
  const { t } = useTranslation('sidebar')

  const handleBrowseLocation = async () => {
    const selected = await ipc.dialog.openDirectory()
    if (selected) dispatch({ type: 'setProjectLocation', value: selected })
  }

  const handleCancel = async () => {
    // Fire-and-forget; the awaited create() call will resolve with reason='cancelled'.
    try {
      await ipc.templates.cancel()
    } catch {
      // Cancel is best-effort; if IPC fails we still let the pending promise resolve.
    }
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
          // Log the raw stderr for devtools inspection; the UI shows a classified message.
          if (res.stderr) {
            // eslint-disable-next-line no-console
            console.warn('[QuickStart] create-next-app stderr:', res.stderr)
          }
          const key = errorKeyFor(res.reason)
          if (key) dispatch({ type: 'setError', error: t(key) })
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

  const isCreatingNextjs = state.creating && state.selectedTemplate === 'nextjs'

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
            type="button"
            aria-pressed={state.selectedTemplate === 'empty'}
            className={`template-card${state.selectedTemplate === 'empty' ? ' template-card--selected' : ''}`}
            onClick={() => dispatch({ type: 'setTemplate', value: 'empty' })}
            disabled={state.creating}
          >
            <span className="template-card__icon" aria-hidden="true">📄</span>
            <span className="template-card__name">{t('quickStartTemplateEmpty')}</span>
          </button>
          <button
            type="button"
            aria-pressed={state.selectedTemplate === 'nextjs'}
            className={`template-card${state.selectedTemplate === 'nextjs' ? ' template-card--selected' : ''}`}
            onClick={() => dispatch({ type: 'setTemplate', value: 'nextjs' })}
            disabled={state.creating}
          >
            <span className="template-card__icon" aria-hidden="true">⚡</span>
            <span className="template-card__name">{t('quickStartTemplateNextjs')}</span>
          </button>
        </div>
      </div>

      {state.creating && (
        <div className="dialog-clone-progress">
          <Spinner size="sm" />
          <span>
            {state.selectedTemplate === 'nextjs' ? t('quickStartCreatingNextjs') : t('quickStartCreating')}
          </span>
          {isCreatingNextjs && (
            <Button onClick={handleCancel}>
              {t('cancel', { ns: 'common' })}
            </Button>
          )}
        </div>
      )}
    </>
  )
}
