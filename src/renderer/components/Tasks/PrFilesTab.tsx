import { useCallback, useEffect, useMemo, useState } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { Badge, Button } from '@/components/ui'
import {
  IconArrowDown,
  IconArrowUp,
  IconCheckmark,
  IconClose,
  IconCheckCircle,
  IconExternalLinkSmall,
  IconEye,
  IconFile,
  IconMessageBubble,
  IconMessagePlus,
  IconSearch,
} from '@/components/shared/icons'
import * as ipc from '@/lib/ipc'
import { ReviewCommentEntry } from './PrConversationTab'
import type { GitHubPrFile } from './types'
import type { PrDetailController } from './usePrDetailController'
import {
  formatFileSize,
  formatSignedCount,
  getDiffFileStatusLabel,
} from './taskUtils'
import { PrReviewSubmitForm } from './PrReviewSubmitForm'

type FileFilter = 'all' | 'unviewed' | 'commented'
type FileSort = 'path' | 'largest' | 'status'

interface FileReviewItem {
  file: GitHubPrFile
  directory: string
  name: string
  commentCount: number
  viewed: boolean
}

export function PrFilesTab({ detail }: { detail: PrDetailController }) {
  const { t } = useTranslation('tasks')
  const { review, prDetail, selectedPrFile, selectedDiffLines, rootReviewComments } = detail
  const [fileFilter, setFileFilter] = useState<FileFilter>('all')
  const [fileSort, setFileSort] = useState<FileSort>('path')
  const files = prDetail?.files ?? []

  const commentCountsByPath = useMemo(() => {
    const counts = new Map<string, number>()
    for (const comment of rootReviewComments) {
      if (!comment.path) continue
      counts.set(comment.path, (counts.get(comment.path) ?? 0) + 1)
    }
    return counts
  }, [rootReviewComments])
  const fileItems = useMemo<FileReviewItem[]>(() => files.map((file) => ({
    file,
    directory: getDirectoryName(file.path, t),
    name: getFileName(file.path),
    commentCount: commentCountsByPath.get(file.path) ?? 0,
    viewed: file.viewedState === 'VIEWED',
  })), [commentCountsByPath, files, t])
  const reviewStats = useMemo(() => {
    const viewedCount = fileItems.filter((item) => item.viewed).length
    const commentedCount = fileItems.filter((item) => item.commentCount > 0).length
    return {
      total: fileItems.length,
      viewed: viewedCount,
      unviewed: fileItems.length - viewedCount,
      commented: commentedCount,
    }
  }, [fileItems])
  const filteredFileItems = useMemo(() => sortFileItems(fileItems.filter((item) => {
    if (fileFilter === 'unviewed') return !item.viewed
    if (fileFilter === 'commented') return item.commentCount > 0
    return true
  }), fileSort), [fileFilter, fileItems, fileSort])
  const groupedFileItems = useMemo(() => groupFileItems(filteredFileItems), [filteredFileItems])
  const selectedFileIndex = fileItems.findIndex((item) => item.file.path === selectedPrFile?.path)
  const selectedFilteredFileIndex = filteredFileItems.findIndex((item) => item.file.path === selectedPrFile?.path)

  const selectFile = useCallback((path: string) => {
    review.setSelectedFilePath(path)
    review.setInlineCommentTarget(null)
    review.setInlineCommentBody('')
    review.setInlineCommentError(null)
    review.setDiffSearchMatchIndex(0)
  }, [review])
  const selectRelativeFile = useCallback((direction: -1 | 1) => {
    if (fileItems.length === 0) return
    const current = selectedFileIndex >= 0 ? selectedFileIndex : 0
    const next = (current + direction + fileItems.length) % fileItems.length
    selectFile(fileItems[next].file.path)
  }, [fileItems, selectFile, selectedFileIndex])
  const selectRelativeVisibleFile = useCallback((direction: -1 | 1) => {
    if (filteredFileItems.length === 0) return
    const current = selectedFilteredFileIndex >= 0 ? selectedFilteredFileIndex : 0
    const next = (current + direction + filteredFileItems.length) % filteredFileItems.length
    selectFile(filteredFileItems[next].file.path)
  }, [filteredFileItems, selectFile, selectedFilteredFileIndex])
  const selectVisibleFileAt = useCallback((index: number) => {
    const item = filteredFileItems[index]
    if (item) selectFile(item.file.path)
  }, [filteredFileItems, selectFile])
  const selectNextUnviewedFile = useCallback(() => {
    if (fileItems.length === 0 || reviewStats.unviewed === 0) return
    const start = selectedFileIndex >= 0 ? selectedFileIndex : -1
    for (let offset = 1; offset <= fileItems.length; offset += 1) {
      const next = fileItems[(start + offset + fileItems.length) % fileItems.length]
      if (!next.viewed) {
        selectFile(next.file.path)
        return
      }
    }
  }, [fileItems, reviewStats.unviewed, selectFile, selectedFileIndex])
  const selectNextCommentedFile = useCallback(() => {
    if (fileItems.length === 0 || reviewStats.commented === 0) return
    const start = selectedFileIndex >= 0 ? selectedFileIndex : -1
    for (let offset = 1; offset <= fileItems.length; offset += 1) {
      const next = fileItems[(start + offset + fileItems.length) % fileItems.length]
      if (next.commentCount > 0) {
        selectFile(next.file.path)
        return
      }
    }
  }, [fileItems, reviewStats.commented, selectFile, selectedFileIndex])

  useEffect(() => {
    const matchCount = detail.diffSearchResult.matches.length
    if (matchCount === 0) {
      if (review.diffSearchMatchIndex !== 0) review.setDiffSearchMatchIndex(0)
      return
    }
    if (review.diffSearchMatchIndex >= matchCount) review.setDiffSearchMatchIndex(matchCount - 1)
  }, [detail.diffSearchResult.matches.length, review])

  const activeSearchMatch = detail.diffSearchResult.matches[review.diffSearchMatchIndex]
  useEffect(() => {
    if (!activeSearchMatch) return
    document.getElementById(getDiffLineDomId(activeSearchMatch.lineId))?.scrollIntoView({ block: 'center' })
  }, [activeSearchMatch?.lineId, activeSearchMatch?.matchIndex])

  if (!prDetail) return null

  return (
    <section className="task-detail-panel task-files-panel">
      <div className="task-detail-panel-header">
        <IconFile size={14} />
        <h2>{t('files.changedFiles')}</h2>
        <span>{t('files.changedFilesSummary', { count: prDetail.files.length, additions: formatSignedCount(prDetail.item.additions, '+'), deletions: formatSignedCount(prDetail.item.deletions, '-') })}</span>
      </div>
      {prDetail.files.length === 0 ? (
        <div className="task-detail-empty">{t('files.noChangedFiles')}</div>
      ) : (
        <>
          <FilesReviewToolbar
            fileFilter={fileFilter}
            fileSort={fileSort}
            filteredCount={filteredFileItems.length}
            reviewStats={reviewStats}
            selectedFileIndex={selectedFileIndex}
            onFilterChange={setFileFilter}
            onSortChange={setFileSort}
            onSelectRelativeFile={selectRelativeFile}
            onSelectNextUnviewedFile={selectNextUnviewedFile}
            onSelectNextCommentedFile={selectNextCommentedFile}
            reviewOpen={review.reviewSubmitOpen}
            reviewBusy={review.reviewSubmitBusy !== null}
            canReview={prDetail.item.state === 'open'}
            onToggleReview={() => {
              review.setReviewSubmitOpen(!review.reviewSubmitOpen)
              review.setReviewSubmitError(null)
            }}
          />
          {review.reviewSubmitOpen && <FilesReviewSubmitPanel detail={detail} />}
          <div className="task-files-layout">
            <div
              className="task-file-list"
              aria-label={t('files.changedFilesAria')}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  selectRelativeVisibleFile(1)
                  return
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  selectRelativeVisibleFile(-1)
                  return
                }
                if (event.key === 'Home') {
                  event.preventDefault()
                  selectVisibleFileAt(0)
                  return
                }
                if (event.key === 'End') {
                  event.preventDefault()
                  selectVisibleFileAt(filteredFileItems.length - 1)
                }
              }}
            >
              {groupedFileItems.length === 0 ? (
                <div className="task-file-list-empty">{t('files.noFilesMatch')}</div>
              ) : groupedFileItems.map((group) => (
                <div className="task-file-group" key={group.directory}>
                  <div className="task-file-group-header">
                    <span>{group.directory}</span>
                    <em>{group.items.length}</em>
                  </div>
                  {group.items.map((item) => (
                    <FileRow
                      key={item.file.path}
                      item={item}
                      active={selectedPrFile?.path === item.file.path}
                      onSelect={selectFile}
                    />
                  ))}
                </div>
              ))}
            </div>
            <div className="task-file-diff">
              {selectedPrFile && <DiffHeader detail={detail} />}
              {!selectedPrFile ? (
                <div className="task-detail-empty">{t('files.selectFile')}</div>
              ) : selectedPrFile.isBinary || selectedDiffLines.length === 0 ? (
                <FilePreview detail={detail} />
              ) : (
                <DiffLines detail={detail} />
              )}
            </div>
          </div>
        </>
      )}
    </section>
  )
}

function FilesReviewToolbar({
  fileFilter,
  fileSort,
  filteredCount,
  reviewStats,
  selectedFileIndex,
  onFilterChange,
  onSortChange,
  onSelectRelativeFile,
  onSelectNextUnviewedFile,
  onSelectNextCommentedFile,
  reviewOpen,
  reviewBusy,
  canReview,
  onToggleReview,
}: {
  fileFilter: FileFilter
  fileSort: FileSort
  filteredCount: number
  reviewStats: { total: number; viewed: number; unviewed: number; commented: number }
  selectedFileIndex: number
  onFilterChange: (value: FileFilter) => void
  onSortChange: (value: FileSort) => void
  onSelectRelativeFile: (direction: -1 | 1) => void
  onSelectNextUnviewedFile: () => void
  onSelectNextCommentedFile: () => void
  reviewOpen: boolean
  reviewBusy: boolean
  canReview: boolean
  onToggleReview: () => void
}) {
  const { t } = useTranslation('tasks')
  const filterOptions: Array<{ value: FileFilter; label: string; count: number }> = [
    { value: 'all', label: t('files.all'), count: reviewStats.total },
    { value: 'unviewed', label: t('files.unviewed'), count: reviewStats.unviewed },
    { value: 'commented', label: t('files.commented'), count: reviewStats.commented },
  ]

  return (
    <div className="task-files-review-toolbar">
      <div className="task-files-progress">
        <strong>{t('files.viewedProgress', { viewed: reviewStats.viewed, total: reviewStats.total })}</strong>
        <span>{t('files.unviewedCount', { count: reviewStats.unviewed })}</span>
        <span>{t('files.commentedCount', { count: reviewStats.commented })}</span>
      </div>
      <div className="task-files-toolbar-actions">
        <div className="task-files-filter" role="group" aria-label={t('files.fileFilterAria')}>
          {filterOptions.map(({ value, label, count }) => (
            <button
              key={value}
              type="button"
              className={fileFilter === value ? 'active' : ''}
              onClick={() => onFilterChange(value)}
            >
              <span>{label}</span>
              <em>{count}</em>
            </button>
          ))}
        </div>
        <label className="task-files-sort">
          <span>{t('files.sort')}</span>
          <select value={fileSort} onChange={(event) => onSortChange(event.target.value as FileSort)}>
            <option value="path">{t('files.sortPath')}</option>
            <option value="largest">{t('files.sortLargest')}</option>
            <option value="status">{t('files.sortStatus')}</option>
          </select>
        </label>
        <div className="task-files-nav" aria-label={t('files.navigationAria')}>
          <button type="button" onClick={() => onSelectRelativeFile(-1)} disabled={reviewStats.total <= 1} aria-label={t('files.previousFile')} title={t('files.previousFile')}>
            <IconArrowUp size={12} />
          </button>
          <span>{selectedFileIndex >= 0 ? selectedFileIndex + 1 : 0}/{reviewStats.total}</span>
          <button type="button" onClick={() => onSelectRelativeFile(1)} disabled={reviewStats.total <= 1} aria-label={t('files.nextFile')} title={t('files.nextFile')}>
            <IconArrowDown size={12} />
          </button>
        </div>
        <button type="button" className="task-files-next-target" onClick={onSelectNextUnviewedFile} disabled={reviewStats.unviewed === 0}>
          {t('files.nextUnviewed')}
        </button>
        <button type="button" className="task-files-next-target" onClick={onSelectNextCommentedFile} disabled={reviewStats.commented === 0}>
          {t('files.nextComment')}
        </button>
        <button
          type="button"
          className={`task-files-review-submit-trigger${reviewOpen ? ' active' : ''}`}
          onClick={onToggleReview}
          disabled={!canReview || reviewBusy}
        >
          {reviewBusy ? <span className="task-reviewer-saving-dot" /> : <IconCheckCircle size={13} />}
          {reviewBusy ? t('review.submitting') : t('review.reviewChanges')}
        </button>
        <span className="task-files-filter-count">{t('files.shown', { count: filteredCount })}</span>
      </div>
    </div>
  )
}

function FilesReviewSubmitPanel({ detail }: { detail: PrDetailController }) {
  const { t } = useTranslation('tasks')
  const { detailItem, review } = detail
  if (!detailItem || detailItem.type !== 'pr' || detailItem.state !== 'open') return null

  return (
    <div className="task-files-review-submit-panel">
      <div className="task-files-review-submit-copy">
        <strong>{t('review.finishReview')}</strong>
        <span>{t('review.finishReviewBody')}</span>
      </div>
      <button
        type="button"
        className="task-files-review-submit-close"
        onClick={() => review.setReviewSubmitOpen(false)}
        disabled={review.reviewSubmitBusy !== null}
        aria-label={t('review.closeForm')}
        title={t('review.closeForm')}
      >
        <IconClose size={9} />
      </button>
      <PrReviewSubmitForm detail={detail} className="task-review-submit task-review-submit--files" />
    </div>
  )
}

function FileRow({ item, active, onSelect }: { item: FileReviewItem; active: boolean; onSelect: (path: string) => void }) {
  const { t } = useTranslation('tasks')
  const { file, name, commentCount, viewed } = item
  return (
    <button
      type="button"
      className={`task-file-row${active ? ' active' : ''}${viewed ? ' task-file-row--viewed' : ''}`}
      onClick={() => onSelect(file.path)}
      aria-current={active ? 'true' : undefined}
    >
      <span className="task-file-row-main">
        <span className="task-file-row-name" title={file.path}>{name}</span>
        <span className="task-file-row-status">{getDiffFileStatusLabel(file, t)}</span>
      </span>
      <span className="task-file-row-meta">
        {viewed && (
          <em className="task-file-row-pill task-file-row-pill--viewed">
            <IconCheckmark size={11} />
            {t('files.viewed')}
          </em>
        )}
        {commentCount > 0 && (
          <em className="task-file-row-pill">
            <IconMessageBubble size={11} />
            {commentCount}
          </em>
        )}
        <span className="task-file-row-delta">
          <strong>+{file.additions}</strong>
          <strong>-{file.deletions}</strong>
        </span>
      </span>
    </button>
  )
}

function DiffHeader({ detail }: { detail: PrDetailController }) {
  const { t } = useTranslation('tasks')
  const { review, prDetail, selectedPrFile, actions, diffSearchResult } = detail
  if (!selectedPrFile || !prDetail) return null
  const viewed = selectedPrFile.viewedState === 'VIEWED'
  const viewedLabel = viewed ? t('files.unmarkViewed') : t('files.markViewed')
  const fileUrl = buildGitHubFileUrl(prDetail, selectedPrFile.path)
  const matchCount = diffSearchResult.matches.length
  const hasSearchTerm = diffSearchResult.term.length > 0
  const activeMatchNumber = matchCount > 0 ? Math.min(review.diffSearchMatchIndex + 1, matchCount) : 0
  const goToSearchMatch = (direction: -1 | 1) => {
    if (matchCount === 0) return
    review.setDiffSearchMatchIndex((current) => (current + direction + matchCount) % matchCount)
  }

  return (
    <div className="task-file-diff-header">
      <div className="task-file-diff-title">
        <strong title={selectedPrFile.path}>{selectedPrFile.path}</strong>
        <span>{getDiffFileStatusLabel(selectedPrFile, t)}</span>
      </div>
      <div className="task-file-diff-controls">
        <div className="task-diff-search-shell">
          <label className="task-diff-search-field">
            <IconSearch size={13} />
            <input
              className="task-diff-search"
              value={review.diffSearch}
              onChange={(event) => review.setDiffSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return
                event.preventDefault()
                goToSearchMatch(event.shiftKey ? -1 : 1)
              }}
              placeholder={t('files.searchDiff')}
              aria-label={t('files.searchDiff')}
            />
            {hasSearchTerm && (
              <button type="button" onClick={() => review.setDiffSearch('')} aria-label={t('files.clearDiffSearch')} title={t('files.clearDiffSearch')}>
                <IconClose size={8} />
              </button>
            )}
          </label>
          {hasSearchTerm && (
            <div className={matchCount > 0 ? 'task-diff-search-results' : 'task-diff-search-results task-diff-search-results--empty'}>
              <span>{matchCount > 0 ? `${activeMatchNumber}/${matchCount}` : t('files.noMatches')}</span>
              <button type="button" onClick={() => goToSearchMatch(-1)} disabled={matchCount === 0} aria-label={t('files.previousSearchMatch')} title={t('files.previousSearchMatch')}>
                <IconArrowUp size={11} />
              </button>
              <button type="button" onClick={() => goToSearchMatch(1)} disabled={matchCount === 0} aria-label={t('files.nextSearchMatch')} title={t('files.nextSearchMatch')}>
                <IconArrowDown size={11} />
              </button>
            </div>
          )}
        </div>
        <div className="task-file-diff-actions">
          <div className="task-diff-view-toggle" role="group" aria-label={t('files.diffView')}>
            <button type="button" className={review.diffViewMode === 'unified' ? 'active' : ''} onClick={() => review.setDiffViewMode('unified')}>{t('files.unified')}</button>
            <button type="button" className={review.diffViewMode === 'split' ? 'active' : ''} onClick={() => review.setDiffViewMode('split')}>{t('files.split')}</button>
          </div>
          <button
            type="button"
            className="task-diff-viewed-button"
            onClick={() => actions.handleToggleFileViewed(selectedPrFile, !viewed)}
            disabled={!prDetail.item.pullRequestId || review.pendingViewedPaths.has(selectedPrFile.path)}
            aria-label={viewedLabel}
            title={viewedLabel}
          >
            <IconEye size={13} />
            <span>{viewedLabel}</span>
          </button>
          {fileUrl && (
            <button type="button" className="task-diff-open-file-button" onClick={() => ipc.shell.openExternal(fileUrl)} aria-label={t('files.openFileOnGitHub')} title={t('files.openFileOnGitHub')}>
              <IconExternalLinkSmall size={10} />
            </button>
          )}
          <Badge variant="muted" size="sm" className="task-file-diff-stat">+{selectedPrFile.additions} / -{selectedPrFile.deletions}</Badge>
        </div>
      </div>
    </div>
  )
}

function FilePreview({ detail }: { detail: PrDetailController }) {
  const { t } = useTranslation('tasks')
  const { review, prDetail, selectedPrFile, filePreviews } = detail
  if (!selectedPrFile || !prDetail) return null
  const preview = filePreviews[selectedPrFile.path]
  const fileUrl = buildGitHubFileUrl(prDetail, selectedPrFile.path)
  return (
    <div className="task-file-preview">
      <div className="task-file-preview-toolbar">
        <div>
          <strong>{getFileName(selectedPrFile.path)}</strong>
          <span>{getDiffFileStatusLabel(selectedPrFile, t)} / +{selectedPrFile.additions} / -{selectedPrFile.deletions}</span>
        </div>
        {fileUrl && (
          <button type="button" onClick={() => ipc.shell.openExternal(fileUrl)}>
            <IconExternalLinkSmall size={10} />
            {t('files.openFile')}
          </button>
        )}
      </div>
      {review.filePreviewLoadingPath === selectedPrFile.path ? (
        <div className="task-detail-empty">{t('files.loadingPreview')}</div>
      ) : preview?.kind === 'image' && preview.dataUrl ? (
        <div className="task-file-preview-image">
          <img src={preview.dataUrl} alt={selectedPrFile.path} />
          <span>{preview.mimeType} / {formatFileSize(preview.size)}</span>
        </div>
      ) : preview?.kind === 'text' ? (
        <pre className="task-file-preview-text"><code>{preview.text}</code></pre>
      ) : (
        <div className="task-detail-empty">
          {selectedPrFile.isBinary ? t('files.binaryPreviewUnavailable') : t('files.noTextDiff')}
        </div>
      )}
    </div>
  )
}

function DiffLines({ detail }: { detail: PrDetailController }) {
  const { review, selectedPrFile, visibleDiffLines, diffSearchResult } = detail
  if (!selectedPrFile) return null
  const activeSearchMatch = diffSearchResult.matches[review.diffSearchMatchIndex]
  return (
    <div className={`task-diff-lines task-diff-lines--${review.diffViewMode}`}>
      {visibleDiffLines.map((line) => (
        <DiffLineGroup
          key={line.id}
          detail={detail}
          line={line}
          searchTerm={diffSearchResult.term}
          activeSearchMatch={activeSearchMatch?.lineId === line.id ? activeSearchMatch : null}
        />
      ))}
    </div>
  )
}

function DiffLineGroup({
  detail,
  line,
  searchTerm,
  activeSearchMatch,
}: {
  detail: PrDetailController
  line: PrDetailController['visibleDiffLines'][number]
  searchTerm: string
  activeSearchMatch: { matchIndex: number } | null
}) {
  const { review, selectedPrFile, inlineCommentsByPathLine, reviewRepliesByParent } = detail
  if (!selectedPrFile) return null
  const commentSide = line.kind === 'delete' ? 'LEFT' : 'RIGHT'
  const commentLine = line.kind === 'delete' ? line.oldLine : line.newLine
  const canComment = line.kind !== 'hunk' && line.kind !== 'note'
  const lineComments = commentLine !== null ? inlineCommentsByPathLine.get(`${selectedPrFile.path}:${commentSide}:${commentLine}`) ?? [] : []
  const targetActive = review.inlineCommentTarget?.path === selectedPrFile.path && review.inlineCommentTarget.side === commentSide && review.inlineCommentTarget.line === commentLine

  return (
    <div
      id={getDiffLineDomId(line.id)}
      className={`task-diff-line-group${activeSearchMatch ? ' task-diff-line-group--active-search' : ''}`}
      data-task-diff-line-id={line.id}
    >
      {review.diffViewMode === 'split' ? (
        <div className={`task-diff-line task-diff-line--split task-diff-line--${line.kind}`}>
          <span className="task-diff-line-number task-diff-line-number--old">{line.oldLine ?? ''}</span>
          <code className="task-diff-old">
            <DiffLineContent text={line.kind === 'add' ? ' ' : line.text || ' '} searchTerm={line.kind === 'add' ? '' : searchTerm} activeMatchIndex={line.kind === 'add' ? null : activeSearchMatch?.matchIndex ?? null} />
          </code>
          <span className="task-diff-line-number task-diff-line-number--new">{line.newLine ?? ''}</span>
          <code className="task-diff-new">
            <DiffLineContent text={line.kind === 'delete' ? ' ' : line.text || ' '} searchTerm={line.kind === 'delete' ? '' : searchTerm} activeMatchIndex={line.kind === 'delete' ? null : activeSearchMatch?.matchIndex ?? null} />
          </code>
          <CommentLineButton detail={detail} canComment={canComment} commentLine={commentLine} commentSide={commentSide} text={line.text} />
        </div>
      ) : (
        <div className={`task-diff-line task-diff-line--${line.kind}`}>
          <span className="task-diff-line-number task-diff-line-number--old">{line.oldLine ?? ''}</span>
          <span className="task-diff-line-number task-diff-line-number--new">{line.newLine ?? ''}</span>
          <CommentLineButton detail={detail} canComment={canComment} commentLine={commentLine} commentSide={commentSide} text={line.text} />
          <code><DiffLineContent text={line.text || ' '} searchTerm={searchTerm} activeMatchIndex={activeSearchMatch?.matchIndex ?? null} /></code>
        </div>
      )}
      {targetActive && <InlineCommentComposer detail={detail} />}
      {lineComments.length > 0 && (
        <div className="task-inline-comments">
          {lineComments.map((comment) => (
            <ReviewCommentEntry
              key={`inline-comment:${comment.id}`}
              detail={detail}
              comment={comment}
              replies={reviewRepliesByParent.get(comment.id) ?? []}
              compact
            />
          ))}
        </div>
      )}
    </div>
  )
}

function DiffLineContent({ text, searchTerm, activeMatchIndex }: { text: string; searchTerm: string; activeMatchIndex: number | null }) {
  const term = searchTerm.trim()
  if (!term) return <>{text}</>
  const lowerText = text.toLowerCase()
  const lowerTerm = term.toLowerCase()
  const parts = []
  let cursor = 0
  let matchIndex = 0
  while (cursor <= text.length) {
    const start = lowerText.indexOf(lowerTerm, cursor)
    if (start < 0) break
    if (start > cursor) parts.push(<span key={`text:${cursor}`}>{text.slice(cursor, start)}</span>)
    const end = start + term.length
    parts.push(
      <mark
        key={`hit:${start}:${matchIndex}`}
        className={activeMatchIndex === matchIndex ? 'task-diff-search-hit task-diff-search-hit--active' : 'task-diff-search-hit'}
      >
        {text.slice(start, end)}
      </mark>
    )
    matchIndex += 1
    cursor = end
  }
  if (parts.length === 0) return <>{text}</>
  if (cursor < text.length) parts.push(<span key={`text:${cursor}`}>{text.slice(cursor)}</span>)
  return <>{parts}</>
}

function CommentLineButton({ detail, canComment, commentLine, commentSide, text }: {
  detail: PrDetailController
  canComment: boolean
  commentLine: number | null
  commentSide: 'LEFT' | 'RIGHT'
  text: string
}) {
  const { t } = useTranslation('tasks')
  const { review, selectedPrFile } = detail
  return (
    <span className="task-diff-line-action">
      {canComment && commentLine !== null && selectedPrFile && (
        <button
          type="button"
          onClick={() => {
            review.setInlineCommentTarget({ path: selectedPrFile.path, line: commentLine, side: commentSide, preview: text })
            review.setInlineCommentBody('')
            review.setInlineCommentError(null)
          }}
          aria-label={t('files.commentOnLine', { line: commentLine })}
          title={t('files.commentOnLine', { line: commentLine })}
        >
          <IconMessagePlus size={13} />
        </button>
      )}
    </span>
  )
}

function getDirectoryName(path: string, t: TFunction<'tasks'>): string {
  const index = path.lastIndexOf('/')
  return index > 0 ? path.slice(0, index) : t('files.repositoryRoot')
}

function getFileName(path: string): string {
  return path.split('/').pop() || path
}

function sortFileItems(items: FileReviewItem[], sort: FileSort): FileReviewItem[] {
  const sorted = [...items]
  if (sort === 'largest') {
    sorted.sort((a, b) => (b.file.additions + b.file.deletions) - (a.file.additions + a.file.deletions) || a.file.path.localeCompare(b.file.path))
    return sorted
  }
  if (sort === 'status') {
    sorted.sort((a, b) => a.file.status.localeCompare(b.file.status) || a.file.path.localeCompare(b.file.path))
    return sorted
  }
  sorted.sort((a, b) => a.file.path.localeCompare(b.file.path))
  return sorted
}

function groupFileItems(items: FileReviewItem[]): Array<{ directory: string; items: FileReviewItem[] }> {
  const groups = new Map<string, FileReviewItem[]>()
  for (const item of items) {
    const group = groups.get(item.directory) ?? []
    group.push(item)
    groups.set(item.directory, group)
  }
  return Array.from(groups.entries()).map(([directory, groupItems]) => ({ directory, items: groupItems }))
}

function getDiffLineDomId(lineId: string): string {
  return `task-diff-line-${lineId.replace(/[^a-zA-Z0-9_-]/g, '-')}`
}

function buildGitHubFileUrl(prDetail: NonNullable<PrDetailController['prDetail']>, path: string): string | null {
  const repo = prDetail.item.repoNameWithOwner.trim()
  const ref = prDetail.item.headRefOid || prDetail.item.headBranch
  if (!repo || !ref) return null
  const encodedPath = path.split('/').map((part) => encodeURIComponent(part)).join('/')
  return `https://github.com/${repo}/blob/${encodeURIComponent(ref)}/${encodedPath}`
}

function InlineCommentComposer({ detail }: { detail: PrDetailController }) {
  const { t } = useTranslation('tasks')
  const { review, actions } = detail
  if (!review.inlineCommentTarget) return null
  return (
    <div className="task-inline-comment-composer">
      <div className="task-inline-comment-target">
        <span>{t('files.inlineTarget', { path: review.inlineCommentTarget.path, line: review.inlineCommentTarget.line, side: review.inlineCommentTarget.side === 'LEFT' ? t('files.sideLeft') : t('files.sideRight') })}</span>
        <code>{review.inlineCommentTarget.preview || ' '}</code>
      </div>
      <textarea value={review.inlineCommentBody} onChange={(event) => review.setInlineCommentBody(event.target.value)} placeholder={t('files.inlineCommentPlaceholder')} rows={3} />
      <div className="task-detail-composer-actions">
        {review.inlineCommentError && <span>{review.inlineCommentError}</span>}
        <Button size="sm" onClick={() => review.setInlineCommentTarget(null)} disabled={review.postingInlineComment}>{t('conversation.cancel')}</Button>
        <Button size="sm" onClick={actions.handleSubmitInlineComment} loading={review.postingInlineComment} disabled={!review.inlineCommentBody.trim()}>
          {t('conversation.comment')}
        </Button>
      </div>
    </div>
  )
}
