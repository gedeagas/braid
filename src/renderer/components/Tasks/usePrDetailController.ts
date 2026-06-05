import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Worktree } from '@/types'
import { useTasksReviewStore } from '@/store/tasks'
import * as ipc from '@/lib/ipc'
import { getPRCommentAudienceCounts, isBotPRComment } from '../../../shared/pr-comment-audience'
import { PR_DETAIL_STALE_MS } from './constants'
import type {
  GitHubPrDetail,
  GitHubPrFilePreview,
  TaskRow,
  TimelineEntry,
  UiIssueComment,
  UiReviewComment,
} from './types'
import { checkVariant, getCheckState, groupChecks, isLikelyPreviewFile, parsePatch } from './taskUtils'
import { usePrDetailActions } from './usePrDetailActions'

const prDetailRenderCache = new Map<string, { detail: GitHubPrDetail; fetchedAt: number }>()
const prDetailInFlight = new Map<string, Promise<GitHubPrDetail>>()

interface UsePrDetailControllerArgs {
  selectedRow: TaskRow | null
  setSelectedRow: (value: TaskRow | null | ((current: TaskRow | null) => TaskRow | null)) => void
  fetchTasks: (forceRefresh?: boolean) => void
  addWorktree: (projectId: string, branch: string, baseBranch?: string, filesToCopy?: string[], options?: { select?: boolean }) => Promise<Worktree | null>
  selectWorktree: (projectId: string, worktreeId: string) => void
  toggleTasks: () => void
}

export function usePrDetailController(args: UsePrDetailControllerArgs) {
  const { t } = useTranslation('tasks')
  const { selectedRow, setSelectedRow, fetchTasks, addWorktree, selectWorktree, toggleTasks } = args
  const review = useTasksReviewStore()
  const {
    activityFilter,
    diffSearch,
    filePreviewLoadingPath,
    resetPrDetailUi,
    selectedFilePath,
    setFilePreviewLoadingPath,
    setSelectedFilePath,
  } = review
  const [prDetail, setPrDetail] = useState<GitHubPrDetail | null>(null)
  const [prDetailLoading, setPrDetailLoading] = useState(false)
  const [prDetailError, setPrDetailError] = useState<string | null>(null)
  const [filePreviews, setFilePreviews] = useState<Record<string, GitHubPrFilePreview>>({})
  const [optimisticIssueComments, setOptimisticIssueComments] = useState<UiIssueComment[]>([])
  const [optimisticReviewReplies, setOptimisticReviewReplies] = useState<UiReviewComment[]>([])
  const pendingCommentIdRef = useRef(-1)

  const loadPrDetail = useCallback((row: TaskRow, forceRefresh = false): Promise<GitHubPrDetail> => {
    const cacheKey = `${row.repoPath}:${row.item.number}`
    const cached = prDetailRenderCache.get(cacheKey)
    if (!forceRefresh && cached && Date.now() - cached.fetchedAt < PR_DETAIL_STALE_MS) return Promise.resolve(cached.detail)
    const inFlightKey = `${cacheKey}:${forceRefresh ? 'force' : 'normal'}`
    const existing = prDetailInFlight.get(inFlightKey)
    if (existing) return existing
    const request = (ipc.github.getPrDetail(row.repoPath, row.item.number, forceRefresh) as Promise<GitHubPrDetail>)
      .then((detail) => {
        prDetailRenderCache.set(cacheKey, { detail, fetchedAt: Date.now() })
        return detail
      })
      .finally(() => prDetailInFlight.delete(inFlightKey))
    prDetailInFlight.set(inFlightKey, request)
    return request
  }, [])

  useEffect(() => {
    if (!selectedRow || selectedRow.item.type !== 'pr') return
    let cancelled = false
    const cacheKey = `${selectedRow.repoPath}:${selectedRow.item.number}`
    const cached = prDetailRenderCache.get(cacheKey)
    setPrDetail(cached?.detail ?? null)
    setPrDetailError(null)
    resetPrDetailUi()
    setOptimisticIssueComments([])
    setOptimisticReviewReplies([])
    setFilePreviews({})
    setPrDetailLoading(true)
    void loadPrDetail(selectedRow, false)
      .then((detail) => {
        if (!cancelled) setPrDetail(detail)
      })
      .catch((error: unknown) => {
        if (!cancelled) setPrDetailError(ipc.cleanIpcError(error, t('errors.loadPrDetails')))
      })
      .finally(() => {
        if (!cancelled) setPrDetailLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [loadPrDetail, resetPrDetailUi, selectedRow, t])

  useEffect(() => {
    if (!prDetail) return
    setSelectedFilePath((current) => {
      if (current && prDetail.files.some((file) => file.path === current)) return current
      return prDetail.files[0]?.path ?? null
    })
  }, [prDetail, setSelectedFilePath])

  useEffect(() => {
    if (!selectedRow || !prDetail) return
    prDetailRenderCache.set(`${selectedRow.repoPath}:${selectedRow.item.number}`, { detail: prDetail, fetchedAt: Date.now() })
  }, [prDetail, selectedRow])

  const selectedPrFile = useMemo(
    () => (prDetail?.files ?? []).find((file) => file.path === selectedFilePath) ?? prDetail?.files[0] ?? null,
    [prDetail, selectedFilePath]
  )

  useEffect(() => {
    if (!selectedRow || !prDetail || !selectedPrFile || !isLikelyPreviewFile(selectedPrFile)) return
    if (filePreviews[selectedPrFile.path] || filePreviewLoadingPath === selectedPrFile.path) return
    setFilePreviewLoadingPath(selectedPrFile.path)
    void ipc.github.getPrFilePreview(selectedRow.repoPath, selectedRow.item.number, selectedPrFile.path, prDetail.item.headRefOid)
      .then((preview: unknown) => setFilePreviews((current) => ({ ...current, [selectedPrFile.path]: preview as GitHubPrFilePreview })))
      .catch(() => setFilePreviews((current) => ({
        ...current,
        [selectedPrFile.path]: { path: selectedPrFile.path, kind: 'missing', mimeType: 'application/octet-stream', size: 0 },
      })))
      .finally(() => setFilePreviewLoadingPath(null))
  }, [filePreviewLoadingPath, filePreviews, prDetail, selectedPrFile, selectedRow, setFilePreviewLoadingPath])

  const detailItem = prDetail?.item ?? selectedRow?.item ?? null
  const selectedDiffLines = useMemo(() => parsePatch(selectedPrFile?.patch ?? ''), [selectedPrFile])
  const diffSearchResult = useMemo(() => {
    const term = diffSearch.trim()
    if (!term) return { term, matches: [] }
    const lowerTerm = term.toLowerCase()
    const matches: Array<{ lineId: string; lineIndex: number; matchIndex: number; start: number; end: number }> = []
    for (let lineIndex = 0; lineIndex < selectedDiffLines.length; lineIndex += 1) {
      const line = selectedDiffLines[lineIndex]
      const lowerText = line.text.toLowerCase()
      let fromIndex = 0
      let matchIndex = 0
      while (fromIndex <= lowerText.length) {
        const start = lowerText.indexOf(lowerTerm, fromIndex)
        if (start < 0) break
        matches.push({ lineId: line.id, lineIndex, matchIndex, start, end: start + term.length })
        matchIndex += 1
        fromIndex = start + Math.max(lowerTerm.length, 1)
      }
    }
    return { term, matches }
  }, [diffSearch, selectedDiffLines])
  const visibleDiffLines = useMemo(() => {
    return selectedDiffLines
  }, [selectedDiffLines])
  const issueComments = useMemo<UiIssueComment[]>(
    () => [...(prDetail?.issueComments ?? []), ...optimisticIssueComments].sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()),
    [optimisticIssueComments, prDetail]
  )
  const reviewComments = useMemo<UiReviewComment[]>(
    () => [...(prDetail?.comments ?? []), ...optimisticReviewReplies].sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()),
    [optimisticReviewReplies, prDetail]
  )
  const rootReviewComments = useMemo(() => reviewComments.filter((comment) => comment.inReplyToId === null), [reviewComments])
  const reviewRepliesByParent = useMemo(() => groupReplies(reviewComments), [reviewComments])
  const inlineCommentsByPathLine = useMemo(() => {
    const comments = new Map<string, UiReviewComment[]>()
    for (const comment of rootReviewComments) {
      if (!comment.path || comment.line === null) continue
      const key = `${comment.path}:${comment.side}:${comment.line}`
      const list = comments.get(key) ?? []
      list.push(comment)
      comments.set(key, list)
    }
    for (const list of comments.values()) sortByCreatedAt(list)
    return comments
  }, [rootReviewComments])
  const timelineEntries = useMemo(() => {
    const comments = [
      ...issueComments.map((comment): TimelineEntry => ({ kind: 'issue-comment', at: comment.createdAt, item: comment })),
      ...(prDetail?.reviews ?? []).map((review): TimelineEntry => ({ kind: 'review', at: review.submittedAt, item: review })),
      ...rootReviewComments.map((comment): TimelineEntry => ({ kind: 'review-comment', at: comment.createdAt, item: comment })),
    ]
    return comments.filter((entry) => {
      if (activityFilter === 'bot') return isBotPRComment(entry.item)
      if (activityFilter === 'human') return !isBotPRComment(entry.item)
      return true
    }).sort((a, b) => new Date(a.at || 0).getTime() - new Date(b.at || 0).getTime())
  }, [activityFilter, issueComments, prDetail?.reviews, rootReviewComments])
  const activityCounts = useMemo(
    () => getPRCommentAudienceCounts([...issueComments, ...(prDetail?.reviews ?? []), ...rootReviewComments]),
    [issueComments, prDetail?.reviews, rootReviewComments]
  )

  const actions = usePrDetailActions({
    selectedRow,
    setSelectedRow,
    prDetail,
    setPrDetail,
    review,
    fetchTasks,
    addWorktree,
    loadPrDetail,
    setPrDetailLoading,
    setPrDetailError,
    setOptimisticIssueComments,
    setOptimisticReviewReplies,
    pendingCommentIdRef,
    selectWorktree,
    toggleTasks,
  })

  const passedChecks = prDetail?.checks.filter((check) => checkVariant(check) === 'success').length ?? 0
  const failedChecks = prDetail?.checks.filter((check) => checkVariant(check) === 'danger').length ?? 0
  const pendingChecks = prDetail?.checks.filter((check) => getCheckState(check) === 'pending').length ?? 0
  const skippedChecks = prDetail?.checks.filter((check) => getCheckState(check) === 'skipped').length ?? 0

  const showMergeActions = detailItem?.type === 'pr' &&
    detailItem.state === 'open' &&
    !detailItem.isDraft &&
    (detailItem.mergeable ? detailItem.mergeable === 'MERGEABLE' : true) &&
    (detailItem.mergeStateStatus === 'CLEAN' || detailItem.mergeStateStatus === 'HAS_HOOKS')

  return {
    selectedRow,
    review,
    prDetail,
    prDetailLoading,
    prDetailError,
    filePreviews,
    detailItem,
    selectedPrFile,
    selectedDiffLines,
    visibleDiffLines,
    diffSearchResult,
    issueComments,
    reviewComments,
    rootReviewComments,
    reviewRepliesByParent,
    inlineCommentsByPathLine,
    timelineEntries,
    checkGroups: groupChecks(prDetail?.checks ?? []),
    activityCounts,
    checks: { passedChecks, failedChecks, pendingChecks, skippedChecks },
    detailMarkdownBaseUrl: prDetail?.item.url ?? detailItem?.url,
    showReadyAction: detailItem?.type === 'pr' && detailItem.state === 'open' && detailItem.isDraft,
    showMergeActions,
    checkSummaryLabel: failedChecks > 0
      ? t('checks.summaryFailing', { count: failedChecks })
      : pendingChecks > 0
        ? t('checks.summaryPending', { count: pendingChecks })
        : t('checks.summaryPassing', { count: passedChecks }),
    actions,
  }
}

export type PrDetailController = ReturnType<typeof usePrDetailController>

function groupReplies(reviewComments: UiReviewComment[]): Map<number, UiReviewComment[]> {
  const replies = new Map<number, UiReviewComment[]>()
  for (const comment of reviewComments) {
    if (comment.inReplyToId === null) continue
    const list = replies.get(comment.inReplyToId) ?? []
    list.push(comment)
    replies.set(comment.inReplyToId, list)
  }
  for (const list of replies.values()) sortByCreatedAt(list)
  return replies
}

function sortByCreatedAt<T extends { createdAt: string }>(items: T[]): void {
  items.sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime())
}
