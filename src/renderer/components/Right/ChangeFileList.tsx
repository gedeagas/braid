import { useTranslation } from 'react-i18next'
import type { GitChange } from '@/types'
import type { GitStatusCode } from '@/store/ui'
import { Tooltip } from '@/components/shared/Tooltip'
import { STATUS_META } from './changesState'
import { basename, dirname } from '@/lib/diffUtils'
import { NekoWalk } from './NekoWalk'

interface ChangeFileListProps {
  stagedChanges: GitChange[]
  unstagedChanges: GitChange[]
  stagedCollapsed: boolean
  unstagedCollapsed: boolean
  isClean: boolean
  stagingInProgress: boolean
  onStageFile: (e: React.MouseEvent, file: string) => void
  onUnstageFile: (e: React.MouseEvent, file: string) => void
  onStageAll: (e: React.MouseEvent) => void
  onUnstageAll: (e: React.MouseEvent) => void
  onToggleSection: (section: 'staged' | 'unstaged') => void
  onDiscardRequest: (e: React.MouseEvent, file: string, status: string) => void
  onDiscardAllRequest: (e: React.MouseEvent) => void
  onDiscardAllStagedRequest: (e: React.MouseEvent) => void
  onOpenDiffReview: (file: string, status: GitStatusCode, staged: boolean) => void
}

export function ChangeFileList({
  stagedChanges,
  unstagedChanges,
  stagedCollapsed,
  unstagedCollapsed,
  isClean,
  stagingInProgress,
  onStageFile,
  onUnstageFile,
  onStageAll,
  onUnstageAll,
  onToggleSection,
  onDiscardRequest,
  onDiscardAllRequest,
  onDiscardAllStagedRequest,
  onOpenDiffReview,
}: ChangeFileListProps) {
  const { t } = useTranslation('right')

  return (
    <div className="changes-file-list">
      {/* Staged section */}
      <div
        className="changes-section-header"
        onClick={() => onToggleSection('staged')}
      >
        <span className={`changes-section-chevron${stagedCollapsed ? ' collapsed' : ''}`}>▾</span>
        <span className="changes-section-title">{t('stagedChanges')}</span>
        <span className="changes-section-count">{stagedChanges.length}</span>
        {stagedChanges.length > 0 && (
          <>
            <button className="changes-section-btn" onClick={onUnstageAll} disabled={stagingInProgress}>
              {t('unstageAll')}
            </button>
            <button className="changes-section-btn changes-section-btn--danger" onClick={onDiscardAllStagedRequest}>
              {t('discardAll')}
            </button>
          </>
        )}
      </div>
      <div className={`changes-section-files${stagedCollapsed ? ' collapsed' : ''}`}>
        {stagedChanges.length === 0 ? (
          <div className="changes-section-empty">{t('noStagedFiles')}</div>
        ) : (
          stagedChanges.map((change) => {
            const meta = STATUS_META[change.status] ?? STATUS_META['M']
            const dir = dirname(change.file)
            const name = basename(change.file)
            return (
              <div
                key={`staged-${change.file}`}
                className="change-row"
                onClick={() => onOpenDiffReview(change.file, change.status, true)}
              >
                <Tooltip content={t('unstageFile')} position="right">
                  <button
                    className="change-row-checkbox checked"
                    onClick={(e) => onUnstageFile(e, change.file)}
                    disabled={stagingInProgress}
                  >
                    ✓
                  </button>
                </Tooltip>
                <Tooltip content={`${t(meta.titleKey)}: ${change.file}`} position="right">
                  <span className={`change-badge ${meta.className}`}>{meta.label}</span>
                </Tooltip>
                <span className="change-file-info">
                  <span className="change-file-name">{name}</span>
                  {dir && <span className="change-file-dir">{dir}</span>}
                </span>
              </div>
            )
          })
        )}
      </div>

      {/* Unstaged section */}
      <div
        className="changes-section-header"
        onClick={() => onToggleSection('unstaged')}
      >
        <span className={`changes-section-chevron${unstagedCollapsed ? ' collapsed' : ''}`}>▾</span>
        <span className="changes-section-title">{t('unstagedChanges')}</span>
        <span className="changes-section-count">{unstagedChanges.length}</span>
        {unstagedChanges.length > 0 && (
          <>
            <button className="changes-section-btn" onClick={onStageAll} disabled={stagingInProgress}>
              {t('stageAll')}
            </button>
            <button className="changes-section-btn changes-section-btn--danger" onClick={onDiscardAllRequest}>
              {t('discardAll')}
            </button>
          </>
        )}
      </div>
      <div className={`changes-section-files${unstagedCollapsed ? ' collapsed' : ''}`}>
        {unstagedChanges.map((change) => {
          const meta = STATUS_META[change.status] ?? STATUS_META['M']
          const dir = dirname(change.file)
          const name = basename(change.file)
          return (
            <div
              key={`unstaged-${change.file}`}
              className="change-row"
              onClick={() => onOpenDiffReview(change.file, change.status, false)}
            >
              <Tooltip content={t('stageFile')} position="right">
                <button
                  className="change-row-checkbox"
                  onClick={(e) => onStageFile(e, change.file)}
                  disabled={stagingInProgress}
                />
              </Tooltip>
              <Tooltip content={`${t(meta.titleKey)}: ${change.file}`} position="right">
                <span className={`change-badge ${meta.className}`}>{meta.label}</span>
              </Tooltip>
              <span className="change-file-info">
                <span className="change-file-name">{name}</span>
                {dir && <span className="change-file-dir">{dir}</span>}
              </span>
              <div className="change-row-actions">
                <Tooltip content={t('discardChanges')} position="left">
                  <button
                    className="change-discard-btn"
                    onClick={(e) => { e.stopPropagation(); onDiscardRequest(e, change.file, change.status) }}
                  >
                    ✕
                  </button>
                </Tooltip>
              </div>
            </div>
          )
        })}
      </div>

      {/* Clean state indicator */}
      {isClean && (
        <div className="changes-clean-indicator">
          <NekoWalk />
          <div className="changes-clean-label">
            <span className="changes-clean-icon">✓</span>
            <span>{t('workingTreeClean')}</span>
          </div>
        </div>
      )}
    </div>
  )
}
