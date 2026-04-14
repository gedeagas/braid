import { useEffect } from 'react'
import * as ipc from '@/lib/ipc'
import { useTranslation } from 'react-i18next'
import { Spinner } from '@/components/ui'
import { normalizeGitHubUrl, extractRepoSlug } from './types'
import type { State, Action } from './types'

interface Props {
  state: State
  dispatch: React.Dispatch<Action>
  existingRemoteOrigins: { name: string; origin: string }[]
  addProject: (path: string) => Promise<void>
  onClose: () => void
  onActionRef: React.MutableRefObject<(() => void) | null>
}

export function GitHubTab({ state, dispatch, existingRemoteOrigins, addProject, onClose, onActionRef }: Props) {
  const { t } = useTranslation('sidebar')

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
      onClose()
    } catch {
      dispatch({ type: 'setError', error: t('githubCloneAddedError') })
    }
  }

  useEffect(() => {
    onActionRef.current = handleCloneAndAdd
    return () => { onActionRef.current = null }
  })

  return (
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
  )
}
