import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { GitChange } from '@/types'
import type { GitStatusCode } from '@/store/ui'
import { Tooltip } from '@/components/shared/Tooltip'
import { IconArrowDown, IconArrowUp, IconCheckmark, IconChevronDown, IconTrash } from '@/components/shared/icons'
import { STATUS_META } from './changesState'
import { basename, dirname } from '@/lib/diffUtils'
import { NekoWalk } from './NekoWalk'

function sumStats(changes: GitChange[]): { additions: number; deletions: number } {
  let additions = 0, deletions = 0
  for (const c of changes) {
    additions += c.additions ?? 0
    deletions += c.deletions ?? 0
  }
  return { additions, deletions }
}

interface DiffStatsProps {
  additions?: number
  deletions?: number
  /** Variant controls layout/spacing; visual color tokens are shared. */
  variant?: 'row' | 'section'
}

/** Renders `+N -N` stats; returns null when there's nothing to show. */
function DiffStats({ additions = 0, deletions = 0, variant = 'row' }: DiffStatsProps) {
  if (additions <= 0 && deletions <= 0) return null
  const className = variant === 'section' ? 'change-section-stats' : 'change-diff-stats'
  return (
    <span className={className}>
      {additions > 0 && <span className="change-diff-add">+{additions}</span>}
      {deletions > 0 && <span className="change-diff-del">-{deletions}</span>}
    </span>
  )
}

/** Aggregates line stats across a set of changes. Thin wrapper over `DiffStats`. */
function SectionStats({ changes }: { changes: GitChange[] }) {
  const { additions, deletions } = useMemo(() => sumStats(changes), [changes])
  return <DiffStats additions={additions} deletions={deletions} variant="section" />
}

interface SectionAction {
  label: string
  variant?: 'default' | 'danger'
  icon: 'stage' | 'unstage' | 'discard'
  onClick: (e: React.MouseEvent) => void
  disabled?: boolean
}

interface ChangeSectionHeaderProps {
  id: string
  title: string
  changes: GitChange[]
  collapsed: boolean
  onToggle: () => void
  actions: SectionAction[]
}

function SectionActionIcon({ icon }: { icon: SectionAction['icon'] }) {
  if (icon === 'stage') return <IconArrowUp size={13} />
  if (icon === 'unstage') return <IconArrowDown size={13} />
  return <IconTrash size={13} />
}

function ChangeSectionHeader({ id, title, changes, collapsed, onToggle, actions }: ChangeSectionHeaderProps) {
  return (
    <div className="changes-section-header">
      <button
        type="button"
        className="changes-section-toggle"
        aria-expanded={!collapsed}
        aria-controls={id}
        onClick={onToggle}
      >
        <IconChevronDown className="changes-section-chevron" size={11} />
        <span className="changes-section-title">{title}</span>
        <span className="changes-section-count">{changes.length}</span>
        <SectionStats changes={changes} />
      </button>
      {actions.length > 0 && (
        <div className="changes-section-actions">
          {actions.map((action) => (
            <Tooltip key={action.label} content={action.label} position="left">
              <button
                type="button"
                className={`changes-section-icon-btn${action.variant === 'danger' ? ' danger' : ''}`}
                aria-label={action.label}
                onClick={action.onClick}
                disabled={action.disabled}
              >
                <SectionActionIcon icon={action.icon} />
              </button>
            </Tooltip>
          ))}
        </div>
      )}
    </div>
  )
}

interface ChangeRowProps {
  change: GitChange
  staged: boolean
  stagingInProgress: boolean
  onStageFile: (e: React.MouseEvent, file: string) => void
  onUnstageFile: (e: React.MouseEvent, file: string) => void
  onDiscardRequest: (e: React.MouseEvent, file: string, status: string, staged?: boolean) => void
  onOpenDiffReview: (file: string, status: GitStatusCode, staged: boolean) => void
}

function ChangeRow({
  change,
  staged,
  stagingInProgress,
  onStageFile,
  onUnstageFile,
  onDiscardRequest,
  onOpenDiffReview,
}: ChangeRowProps) {
  const { t } = useTranslation('right')
  const meta = STATUS_META[change.status] ?? STATUS_META['M']
  const dir = dirname(change.file)
  const name = basename(change.file)
  const stageLabel = staged ? t('unstageFile') : t('stageFile')
  const openDiff = () => onOpenDiffReview(change.file, change.status, staged)

  return (
    <div
      className={`change-row${staged ? ' change-row--staged' : ''}`}
    >
      <Tooltip content={stageLabel} position="right">
        <button
          type="button"
          className={`change-row-checkbox${staged ? ' checked' : ''}`}
          aria-label={stageLabel}
          onClick={(e) => staged ? onUnstageFile(e, change.file) : onStageFile(e, change.file)}
          disabled={stagingInProgress}
        >
          {staged && <IconCheckmark size={10} />}
        </button>
      </Tooltip>
      <button
        type="button"
        className="change-row-open"
        aria-label={`${t(meta.titleKey)}: ${change.file}`}
        onClick={openDiff}
      >
        <Tooltip content={`${t(meta.titleKey)}: ${change.file}`} position="right">
          <span className={`change-badge ${meta.className}`}>{meta.label}</span>
        </Tooltip>
        <span className="change-file-info">
          <span className="change-file-name">{name}</span>
          {dir && <span className="change-file-dir">{dir}</span>}
        </span>
        <DiffStats additions={change.additions} deletions={change.deletions} />
      </button>
      <div className="change-row-actions">
        <Tooltip content={t('discardChanges')} position="left">
          <button
            type="button"
            className="change-discard-btn"
            aria-label={t('discardChanges')}
            onClick={(e) => onDiscardRequest(e, change.file, change.status, staged)}
          >
            <IconTrash size={12} />
          </button>
        </Tooltip>
      </div>
    </div>
  )
}

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
  onDiscardRequest: (e: React.MouseEvent, file: string, status: string, staged?: boolean) => void
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

  if (isClean) {
    return (
      <div className="changes-file-list changes-file-list--clean">
        <div className="changes-clean-indicator">
          <NekoWalk />
          <div className="changes-clean-label">
            <span className="changes-clean-icon">✓</span>
            <span>{t('workingTreeClean')}</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="changes-file-list">
      {/* Staged section */}
      <ChangeSectionHeader
        id="changes-staged-files"
        title={t('stagedChanges')}
        changes={stagedChanges}
        collapsed={stagedCollapsed}
        onToggle={() => onToggleSection('staged')}
        actions={stagedChanges.length > 0 ? [
          { label: t('unstageAll'), icon: 'unstage', onClick: onUnstageAll, disabled: stagingInProgress },
          { label: t('discardAll'), icon: 'discard', variant: 'danger', onClick: onDiscardAllStagedRequest },
        ] : []}
      />
      <div id="changes-staged-files" className={`changes-section-files${stagedCollapsed ? ' collapsed' : ''}`}>
        {stagedChanges.length === 0 ? (
          <div className="changes-section-empty">{t('noStagedFiles')}</div>
        ) : (
          stagedChanges.map((change) => (
            <ChangeRow
              key={`staged-${change.file}`}
              change={change}
              staged
              stagingInProgress={stagingInProgress}
              onStageFile={onStageFile}
              onUnstageFile={onUnstageFile}
              onDiscardRequest={onDiscardRequest}
              onOpenDiffReview={onOpenDiffReview}
            />
          ))
        )}
      </div>

      {/* Unstaged section */}
      <ChangeSectionHeader
        id="changes-unstaged-files"
        title={t('unstagedChanges')}
        changes={unstagedChanges}
        collapsed={unstagedCollapsed}
        onToggle={() => onToggleSection('unstaged')}
        actions={unstagedChanges.length > 0 ? [
          { label: t('stageAll'), icon: 'stage', onClick: onStageAll, disabled: stagingInProgress },
          { label: t('discardAll'), icon: 'discard', variant: 'danger', onClick: onDiscardAllRequest },
        ] : []}
      />
      <div id="changes-unstaged-files" className={`changes-section-files${unstagedCollapsed ? ' collapsed' : ''}`}>
        {unstagedChanges.length === 0 ? (
          <div className="changes-section-empty">{t('allChangesStaged')}</div>
        ) : (
          unstagedChanges.map((change) => (
            <ChangeRow
              key={`unstaged-${change.file}`}
              change={change}
              staged={false}
              stagingInProgress={stagingInProgress}
              onStageFile={onStageFile}
              onUnstageFile={onUnstageFile}
              onDiscardRequest={onDiscardRequest}
              onOpenDiffReview={onOpenDiffReview}
            />
          ))
        )}
      </div>
    </div>
  )
}
