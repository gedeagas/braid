import { useReducer, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import * as ipc from '@/lib/ipc'
import { Badge, Button, EmptyState, Spinner } from '@/components/ui'
import { IconCopy, IconClose } from '@/components/shared/icons'

// ── Types ────────────────────────────────────────────────────────────────────

interface FileStatus {
  path: string
  exists: boolean
  size: number
}

interface State {
  fileStatuses: FileStatus[]
  loading: boolean
}

type Action =
  | { type: 'startLoading' }
  | { type: 'setStatuses'; statuses: FileStatus[] }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'startLoading':
      return { ...state, loading: true }
    case 'setStatuses':
      return { fileStatuses: action.statuses, loading: false }
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ── Component ────────────────────────────────────────────────────────────────

interface Props {
  projectPath: string
  copyFiles: string[]
  onUpdate: (files: string[]) => void
}

export function SettingsProjectCopyFiles({ projectPath, copyFiles, onUpdate }: Props) {
  const { t } = useTranslation('settings')
  const [state, dispatch] = useReducer(reducer, { fileStatuses: [], loading: false })

  // Fetch file info whenever the file list changes
  useEffect(() => {
    if (copyFiles.length === 0) {
      dispatch({ type: 'setStatuses', statuses: [] })
      return
    }
    dispatch({ type: 'startLoading' })
    ipc.files.getFileInfo(projectPath, copyFiles)
      .then((info: FileStatus[]) => dispatch({ type: 'setStatuses', statuses: info }))
      .catch(() => dispatch({ type: 'setStatuses', statuses: copyFiles.map((p) => ({ path: p, exists: false, size: 0 })) }))
  }, [projectPath, copyFiles])

  const handleAdd = useCallback(async () => {
    const paths = await ipc.dialog.openFiles(projectPath)
    if (!paths) return
    const relativePaths = await ipc.files.toRelativePaths(projectPath, paths)
    const existing = new Set(copyFiles)
    const merged = [...copyFiles, ...relativePaths.filter((p: string) => !existing.has(p))]
    onUpdate(merged)
  }, [projectPath, copyFiles, onUpdate])

  const handleRemove = useCallback((file: string) => {
    onUpdate(copyFiles.filter((f) => f !== file))
  }, [copyFiles, onUpdate])

  const hasFiles = copyFiles.length > 0
  const missingCount = state.fileStatuses.filter((f) => !f.exists).length

  return (
    <div className="settings-card">
      <div className="settings-copy-files-header">
        <div className="settings-copy-files-title-row">
          <h3 className="settings-card-title">{t('project.copyFilesHeader')}</h3>
          {hasFiles && (
            <Badge variant={missingCount > 0 ? 'warning' : 'muted'} size="sm">{copyFiles.length}</Badge>
          )}
        </div>
        {hasFiles && (
          <Button size="sm" onClick={handleAdd}>+ {t('project.addFiles')}</Button>
        )}
      </div>
      <span className="settings-hint">{t('project.copyFilesHint')}</span>

      {state.loading && (
        <div className="settings-copy-files-loading">
          <Spinner size="sm" />
        </div>
      )}

      {!state.loading && !hasFiles && (
        <EmptyState
          icon={<IconCopy size={24} />}
          title={t('project.noCopyFiles')}
          hint={t('project.noCopyFilesHint')}
          action={<Button size="sm" onClick={handleAdd}>+ {t('project.addFiles')}</Button>}
        />
      )}

      {!state.loading && hasFiles && (
        <div className="settings-copy-files-list">
          {state.fileStatuses.map((file) => (
            <div key={file.path} className={`settings-copy-file-item${!file.exists ? ' settings-copy-file-item--missing' : ''}`}>
              <span className="settings-copy-file-path">{file.path}</span>
              <span className="settings-copy-file-meta">
                {file.exists ? (
                  <Badge variant="muted" size="sm">{formatSize(file.size)}</Badge>
                ) : (
                  <Badge variant="warning" size="sm">{t('project.fileMissing')}</Badge>
                )}
              </span>
              <button
                className="settings-copy-file-remove"
                onClick={() => handleRemove(file.path)}
                aria-label={t('common:remove')}
              >
                <IconClose size={8} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
