import { useTranslation } from 'react-i18next'
import { Badge, Checkbox } from '@/components/ui'
import { formatSize } from './copyFilesReducer'
import type { CopyFilesState, CopyFilesAction } from './copyFilesReducer'

interface Props {
  state: CopyFilesState
  dispatch: React.Dispatch<CopyFilesAction>
}

export function CopyFilesSection({ state, dispatch }: Props) {
  const { t } = useTranslation('sidebar')

  const hasCopyFiles = state.savedFiles.length > 0 || state.discoveredFiles.length > 0

  if (state.loading) {
    return (
      <div className="copy-files-section">
        <span className="copy-files-loading">{t('loadingFiles')}</span>
      </div>
    )
  }

  if (!hasCopyFiles) return null

  return (
    <div className="copy-files-section">
      <div className="copy-files-header">
        <span className="copy-files-header-label">{t('copyFilesSection')}</span>
        {state.sourceBranch && (
          <span className="copy-files-header-source">
            {t('copyFilesFrom', { branch: state.sourceBranch })}
          </span>
        )}
      </div>

      {state.savedFiles.length > 0 && (
        <div className="copy-files-group">
          <div className="copy-files-group-header">
            <span className="copy-files-group-label">{t('defaultFiles')}</span>
            <Badge variant="accent" size="sm">
              {state.savedFiles.filter((f) => f.checked).length}/{state.savedFiles.length}
            </Badge>
          </div>
          {state.savedFiles.map((file) => (
            <div key={file.path} className={`copy-files-item${!file.exists ? ' copy-files-item--missing' : ''}`}>
              <label>
                <Checkbox
                  size="sm"
                  checked={file.checked}
                  disabled={!file.exists}
                  onChange={() => dispatch({ type: 'toggle', group: 'saved', path: file.path })}
                />
                <span className="copy-files-path">{file.path}</span>
              </label>
              {file.exists ? (
                <span className="copy-files-size">{formatSize(file.size)}</span>
              ) : (
                <span className="copy-files-badge">{t('notFound')}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {state.discoveredFiles.length > 0 && (
        <div className="copy-files-group">
          <div className="copy-files-group-header">
            <span className="copy-files-group-label">{t('discoveredFiles')}</span>
            <Badge variant="muted" size="sm">
              {state.discoveredFiles.filter((f) => f.checked).length}/{state.discoveredFiles.length}
            </Badge>
          </div>
          {state.discoveredFiles.map((file) => (
            <div key={file.path} className="copy-files-item">
              <label>
                <Checkbox
                  size="sm"
                  checked={file.checked}
                  onChange={() => dispatch({ type: 'toggle', group: 'discovered', path: file.path })}
                />
                <span className="copy-files-path">{file.path}</span>
              </label>
              <span className="copy-files-size">{formatSize(file.size)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
