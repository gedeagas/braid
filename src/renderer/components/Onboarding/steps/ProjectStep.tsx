import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useProjectsStore } from '@/store/projects'
import { useUIStore } from '@/store/ui'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { IconGitFork } from '@/components/shared/icons'
import * as ipc from '@/lib/ipc'

export function ProjectStep() {
  const { t } = useTranslation('common')
  const addProject = useProjectsStore((s) => s.addProject)
  const storagePath = useUIStore((s) => s.worktreeStoragePath)
  const [cloneUrl, setCloneUrl] = useState('')
  const [cloning, setCloning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [homePath, setHomePath] = useState('')

  useEffect(() => {
    const stored = localStorage.getItem('braid:homePath')
    if (stored) setHomePath(stored)
  }, [])

  const workspacePath = storagePath || homePath || '~/Braid/worktrees'

  const handleBrowse = async () => {
    setError(null)
    const selected = await ipc.dialog.openDirectory()
    if (!selected) return
    try {
      await addProject(selected)
    } catch {
      setError(t('onboarding.project.addError'))
    }
  }

  const handleClone = async () => {
    const url = cloneUrl.trim()
    if (!url) return
    setError(null)
    setCloning(true)
    try {
      const clonedPath = await ipc.git.cloneRepo(url)
      await addProject(clonedPath)
    } catch {
      setError(t('onboarding.project.cloneError'))
    } finally {
      setCloning(false)
    }
  }

  return (
    <div className="ob-step">
      <h1 className="ob-heading">{t('onboarding.project.title')}</h1>
      <p className="ob-subtitle">{t('onboarding.project.subtitle')}</p>

      <div className="ob-project-cards">
        <div className="ob-project-card">
          <div className="ob-project-card-row">
            <div className="ob-action-card-icon">
              <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                <path d="M2 13V3a1 1 0 0 1 1-1h4l2 2h4a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1Z" />
              </svg>
            </div>
            <div className="ob-action-card-body">
              <span className="ob-action-card-title">{t('onboarding.project.openFolder')}</span>
              <span className="ob-action-card-desc">{t('onboarding.project.openFolderDesc')}</span>
            </div>
            <Button onClick={handleBrowse}>{t('onboarding.project.browseBtn')}</Button>
          </div>
        </div>

        <div className="ob-project-card">
          <div className="ob-project-card-row">
            <div className="ob-action-card-icon">
              <IconGitFork size={20} />
            </div>
            <div className="ob-action-card-body">
              <span className="ob-action-card-title">{t('onboarding.project.cloneRepo')}</span>
              <span className="ob-action-card-desc">{t('onboarding.project.cloneRepoDesc')}</span>
            </div>
          </div>
          <div className="ob-clone-input-row">
            <input
              className="ob-clone-input"
              value={cloneUrl}
              onChange={(e) => setCloneUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !cloning) handleClone() }}
              placeholder="git@github.com:org/repo.git"
              disabled={cloning}
              spellCheck={false}
            />
            <Button onClick={handleClone} disabled={cloning || !cloneUrl.trim()}>
              {cloning ? <Spinner size="sm" /> : t('onboarding.project.clone')}
            </Button>
          </div>
        </div>
      </div>

      {error && <p className="ob-error">{error}</p>}

      <div className="ob-workspace-path">
        <span className="ob-workspace-path-label">{t('onboarding.project.workspace')}</span>
        <span className="ob-workspace-path-value">{workspacePath}</span>
      </div>
    </div>
  )
}
