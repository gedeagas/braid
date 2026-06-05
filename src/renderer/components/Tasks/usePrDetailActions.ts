import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { useTasksReviewStore, type TaskPrAction, type TaskReviewSubmitAction } from '@/store/tasks'
import * as ipc from '@/lib/ipc'
import type {
  GitHubPrDetail,
  GitHubPrFile,
  GitHubReactionContent,
  PrIssueComment,
  PrReviewComment,
  TaskRow,
  UiIssueComment,
  UiReviewComment,
} from './types'
import { getCheckState } from './taskUtils'

type MutablePrDetail = ReturnType<typeof useTasksReviewStore.getState>
type TasksT = TFunction<'tasks'>

interface ActionArgs {
  selectedRow: TaskRow | null
  setSelectedRow: (value: TaskRow | null | ((current: TaskRow | null) => TaskRow | null)) => void
  prDetail: GitHubPrDetail | null
  setPrDetail: Dispatch<SetStateAction<GitHubPrDetail | null>>
  review: MutablePrDetail
  fetchTasks: (forceRefresh?: boolean) => void
  openCreateWorktreeDialog: (row: TaskRow) => void
  loadPrDetail: (row: TaskRow, forceRefresh?: boolean) => Promise<GitHubPrDetail>
  setPrDetailLoading: (value: boolean) => void
  setPrDetailError: (value: string | null) => void
  setOptimisticIssueComments: Dispatch<SetStateAction<UiIssueComment[]>>
  setOptimisticReviewReplies: Dispatch<SetStateAction<UiReviewComment[]>>
  pendingCommentIdRef: MutableRefObject<number>
  selectWorktree: (projectId: string, worktreeId: string) => void
  toggleTasks: () => void
}

export function usePrDetailActions(args: ActionArgs) {
  const { t } = useTranslation('tasks')
  const { selectedRow, setPrDetail, review, fetchTasks, openCreateWorktreeDialog, loadPrDetail } = args
  const { setPrDetailLoading, setPrDetailError, selectWorktree, toggleTasks } = args

  const handleOpenMatchingWorktree = useCallback(() => {
    if (!selectedRow?.matchingWorktreeId) return
    selectWorktree(selectedRow.projectId, selectedRow.matchingWorktreeId)
    toggleTasks()
  }, [selectWorktree, selectedRow, toggleTasks])

  const handleRefreshPrDetail = useCallback(() => {
    if (!selectedRow || selectedRow.item.type !== 'pr') return
    setPrDetailLoading(true)
    setPrDetailError(null)
    void loadPrDetail(selectedRow, true).then(setPrDetail)
      .catch((error: unknown) => setPrDetailError(ipc.cleanIpcError(error, t('errors.loadPrDetails'))))
      .finally(() => setPrDetailLoading(false))
  }, [loadPrDetail, selectedRow, setPrDetail, setPrDetailError, setPrDetailLoading, t])

  const handlePrAction = useCallback((action: TaskPrAction) => {
    if (!selectedRow || selectedRow.item.type !== 'pr' || review.prActionBusy) return
    review.setPrActionBusy(action)
    review.setPrActionError(null)
    const request = action === 'ready'
      ? ipc.github.markPrReadyByNumber(selectedRow.repoPath, selectedRow.item.number)
      : action === 'close'
        ? ipc.github.closePrByNumber(selectedRow.repoPath, selectedRow.item.number)
        : ipc.github.mergePrByNumber(selectedRow.repoPath, selectedRow.item.number, action)
    void request
      .then(() => Promise.all([loadPrDetail(selectedRow, true).then(setPrDetail), fetchTasks(true)]))
      .catch((error: unknown) => review.setPrActionError(ipc.cleanIpcError(error, t('errors.updatePullRequest'))))
      .finally(() => review.setPrActionBusy(null))
  }, [fetchTasks, loadPrDetail, review, selectedRow, setPrDetail, t])

  const handleSubmitPrReview = useCallback((event: TaskReviewSubmitAction) => {
    if (!selectedRow || selectedRow.item.type !== 'pr' || review.reviewSubmitBusy) return
    const body = review.reviewSubmitBody.trim()
    if (event !== 'APPROVE' && !body) {
      review.setReviewSubmitError(t('errors.reviewSummaryRequired'))
      return
    }

    review.setReviewSubmitBusy(event)
    review.setReviewSubmitError(null)
    void ipc.github.submitPrReview(selectedRow.repoPath, selectedRow.item.number, event, body)
      .then(() => Promise.all([loadPrDetail(selectedRow, true).then(setPrDetail), fetchTasks(true)]))
      .then(() => {
        review.setReviewSubmitBody('')
        review.setReviewSubmitOpen(false)
      })
      .catch((error: unknown) => {
        const message = ipc.cleanIpcError(error, t('errors.submitReview'))
        review.setReviewSubmitError(message.includes("No handler registered for 'github:submitPrReview'")
          ? t('errors.reviewHandlerUnavailable')
          : message)
      })
      .finally(() => review.setReviewSubmitBusy(null))
  }, [fetchTasks, loadPrDetail, review, selectedRow, setPrDetail, t])

  const handleCreateWorktreeForRow = useCallback((row: TaskRow) => {
    if (row.item.type !== 'pr' || !row.item.headBranch || review.creatingWorktreeForRowId !== null) return
    openCreateWorktreeDialog(row)
  }, [openCreateWorktreeDialog, review.creatingWorktreeForRowId])

  return {
    handleOpenMatchingWorktree,
    handleRefreshPrDetail,
    handlePrAction,
    handleSubmitPrReview,
    handleCreateWorktreeForRow,
    ...useCommentActions(args, t),
    ...useReviewActions(args, t),
    ...useLabelActions(args, t),
    ...useFileActions(args, t),
  }
}

function useCommentActions(args: ActionArgs, t: TasksT) {
  const { selectedRow, setPrDetail, review, setOptimisticIssueComments, pendingCommentIdRef } = args
  const handleSubmitPrComment = useCallback(() => {
    const body = review.prCommentBody.trim()
    if (!selectedRow || selectedRow.item.type !== 'pr' || !body || review.postingPrComment) return
    const tempId = pendingCommentIdRef.current--
    const now = new Date().toISOString()
    const pendingComment: UiIssueComment = { id: tempId, subjectId: '', author: t('currentUser'), authorAvatarUrl: '', isBot: false, body, createdAt: now, updatedAt: now, htmlUrl: '', reactions: [], pending: true }
    review.setPostingPrComment(true)
    review.setCommentError(null)
    review.setPrCommentBody('')
    setOptimisticIssueComments((current) => [...current, pendingComment])
    void ipc.github.addPrComment(selectedRow.repoPath, selectedRow.item.number, body)
      .then((comment: unknown) => {
        setOptimisticIssueComments((current) => current.filter((item) => item.id !== tempId))
        setPrDetail((current) => current ? { ...current, issueComments: [...current.issueComments, comment as PrIssueComment] } : current)
      })
      .catch((error: unknown) => {
        const message = ipc.cleanIpcError(error, t('errors.postComment'))
        review.setCommentError(message)
        setOptimisticIssueComments((current) => current.map((item) => item.id === tempId ? { ...item, pending: false, error: message } : item))
      })
      .finally(() => review.setPostingPrComment(false))
  }, [pendingCommentIdRef, review, selectedRow, setOptimisticIssueComments, setPrDetail, t])

  const patchCommentReactions = useCallback((subjectId: string, content: GitHubReactionContent, reacted: boolean) => {
    const patch = <T extends PrIssueComment | PrReviewComment>(comment: T): T => {
      if (comment.subjectId !== subjectId) return comment
      const reactions = [...comment.reactions]
      const index = reactions.findIndex((reaction) => reaction.content === content)
      if (index >= 0) {
        const current = reactions[index]
        const nextCount = Math.max(reacted ? current.count - 1 : current.count + 1, 0)
        if (nextCount === 0) reactions.splice(index, 1)
        else reactions[index] = { ...current, count: nextCount, viewerHasReacted: !reacted }
      } else if (!reacted) reactions.push({ content, count: 1, viewerHasReacted: true })
      return { ...comment, reactions }
    }
    setPrDetail((current) => current ? { ...current, issueComments: current.issueComments.map(patch), comments: current.comments.map(patch) } : current)
  }, [setPrDetail])

  const handleToggleReaction = useCallback((comment: PrIssueComment | PrReviewComment, content: GitHubReactionContent) => {
    if (!selectedRow || selectedRow.item.type !== 'pr' || !comment.subjectId || review.reactingSubjectIds.has(comment.subjectId)) return
    const reacted = comment.reactions.find((reaction) => reaction.content === content)?.viewerHasReacted === true
    patchCommentReactions(comment.subjectId, content, reacted)
    review.setReactionPending(comment.subjectId, true)
    void ipc.github.toggleReaction(selectedRow.repoPath, selectedRow.item.number, comment.subjectId, content, reacted)
      .catch((error: unknown) => {
        patchCommentReactions(comment.subjectId, content, !reacted)
        review.setCommentError(ipc.cleanIpcError(error, t('errors.updateReaction')))
      })
      .finally(() => review.setReactionPending(comment.subjectId, false))
  }, [patchCommentReactions, review, selectedRow, t])

  return { handleSubmitPrComment, handleToggleReaction }
}

function useReviewActions(args: ActionArgs, t: TasksT) {
  const { selectedRow, setPrDetail, review, loadPrDetail, setOptimisticReviewReplies, pendingCommentIdRef } = args
  const handleSubmitReviewReply = useCallback((comment: PrReviewComment) => {
    const body = review.replyBody.trim()
    if (!selectedRow || selectedRow.item.type !== 'pr' || !body || review.postingReplyId !== null) return
    const tempId = pendingCommentIdRef.current--
    const now = new Date().toISOString()
    const pendingReply: UiReviewComment = {
      id: tempId, subjectId: '', reviewId: comment.reviewId, author: t('currentUser'), authorAvatarUrl: '', isBot: false, body,
      path: comment.path, line: comment.line, startLine: comment.startLine, originalLine: comment.originalLine,
      side: comment.side, diffHunk: '', createdAt: now, updatedAt: now, htmlUrl: '', inReplyToId: comment.id,
      threadId: comment.threadId, isResolved: comment.isResolved, isOutdated: comment.isOutdated, reactions: [], pending: true,
    }
    review.setPostingReplyId(comment.id)
    review.setCommentError(null)
    setOptimisticReviewReplies((current) => [...current, pendingReply])
    review.setReplyingCommentId(null)
    review.setReplyBody('')
    void ipc.github.replyToPrReviewComment(selectedRow.repoPath, selectedRow.item.number, comment.id, body)
      .then((reply: unknown) => {
        setOptimisticReviewReplies((current) => current.filter((item) => item.id !== tempId))
        setPrDetail((current) => current ? { ...current, comments: [...current.comments, reply as PrReviewComment] } : current)
      })
      .catch((error: unknown) => {
        const message = ipc.cleanIpcError(error, t('errors.postReply'))
        review.setCommentError(message)
        setOptimisticReviewReplies((current) => current.map((item) => item.id === tempId ? { ...item, pending: false, error: message } : item))
      })
      .finally(() => review.setPostingReplyId(null))
  }, [pendingCommentIdRef, review, selectedRow, setOptimisticReviewReplies, setPrDetail, t])

  const handleResolveThread = useCallback((comment: PrReviewComment, resolve: boolean) => {
    if (!selectedRow || selectedRow.item.type !== 'pr' || !comment.threadId || review.resolvingThreadIds.has(comment.threadId)) return
    const threadId = comment.threadId
    review.setThreadResolving(threadId, true)
    setPrDetail((current) => current ? { ...current, comments: current.comments.map((item) => item.threadId === threadId ? { ...item, isResolved: resolve } : item) } : current)
    void ipc.github.resolvePrReviewThread(selectedRow.repoPath, selectedRow.item.number, threadId, resolve)
      .catch((error: unknown) => {
        setPrDetail((current) => current ? { ...current, comments: current.comments.map((item) => item.threadId === threadId ? { ...item, isResolved: !resolve } : item) } : current)
        review.setCommentError(ipc.cleanIpcError(error, t('errors.updateReviewThread')))
      })
      .finally(() => review.setThreadResolving(threadId, false))
  }, [review, selectedRow, setPrDetail, t])

  const handleRequestReviewer = useCallback((reviewerOverride?: string) => {
    const reviewer = (reviewerOverride ?? review.reviewerDraft).trim().replace(/^@/, '')
    if (!selectedRow || selectedRow.item.type !== 'pr' || !reviewer || review.reviewerBusy) return
    review.setReviewerBusy(reviewer)
    review.setReviewerError(null)
    void ipc.github.requestPrReviewer(selectedRow.repoPath, selectedRow.item.number, reviewer)
      .then(() => loadPrDetail(selectedRow, true).then((detail) => {
        setPrDetail(detail)
        review.setReviewerDraft('')
      }))
      .catch((error: unknown) => review.setReviewerError(ipc.cleanIpcError(error, t('errors.requestReviewer'))))
      .finally(() => review.setReviewerBusy(null))
  }, [loadPrDetail, review, selectedRow, setPrDetail, t])

  const handleRemoveReviewer = useCallback((reviewer: string) => {
    if (!selectedRow || selectedRow.item.type !== 'pr' || review.reviewerBusy) return
    review.setReviewerBusy(reviewer)
    review.setReviewerError(null)
    void ipc.github.removePrReviewer(selectedRow.repoPath, selectedRow.item.number, reviewer)
      .then(() => loadPrDetail(selectedRow, true).then(setPrDetail))
      .catch((error: unknown) => review.setReviewerError(ipc.cleanIpcError(error, t('errors.removeReviewer'))))
      .finally(() => review.setReviewerBusy(null))
  }, [loadPrDetail, review, selectedRow, setPrDetail, t])

  return { handleSubmitReviewReply, handleResolveThread, handleRequestReviewer, handleRemoveReviewer }
}

function useLabelActions(args: ActionArgs, t: TasksT) {
  const { selectedRow, setPrDetail, review, loadPrDetail, fetchTasks } = args

  const handleAddLabel = useCallback((labelOverride?: string) => {
    const label = (labelOverride ?? review.labelDraft).trim()
    if (!selectedRow || selectedRow.item.type !== 'pr' || !label || review.labelBusy) return
    review.setLabelBusy(label)
    review.setLabelError(null)
    void ipc.github.addPrLabel(selectedRow.repoPath, selectedRow.item.number, label)
      .then(() => loadPrDetail(selectedRow, true).then((detail) => {
        setPrDetail(detail)
        review.setLabelDraft('')
        fetchTasks(true)
      }))
      .catch((error: unknown) => review.setLabelError(ipc.cleanIpcError(error, t('errors.addLabel'))))
      .finally(() => review.setLabelBusy(null))
  }, [fetchTasks, loadPrDetail, review, selectedRow, setPrDetail, t])

  const handleRemoveLabel = useCallback((label: string) => {
    const trimmedLabel = label.trim()
    if (!selectedRow || selectedRow.item.type !== 'pr' || !trimmedLabel || review.labelBusy) return
    review.setLabelBusy(trimmedLabel)
    review.setLabelError(null)
    void ipc.github.removePrLabel(selectedRow.repoPath, selectedRow.item.number, trimmedLabel)
      .then(() => loadPrDetail(selectedRow, true).then((detail) => {
        setPrDetail(detail)
        fetchTasks(true)
      }))
      .catch((error: unknown) => review.setLabelError(ipc.cleanIpcError(error, t('errors.removeLabel'))))
      .finally(() => review.setLabelBusy(null))
  }, [fetchTasks, loadPrDetail, review, selectedRow, setPrDetail, t])

  return { handleAddLabel, handleRemoveLabel }
}

function useFileActions(args: ActionArgs, t: TasksT) {
  const { selectedRow, prDetail, setPrDetail, review } = args
  const handleSubmitInlineComment = useCallback(() => {
    const body = review.inlineCommentBody.trim()
    if (!selectedRow || selectedRow.item.type !== 'pr' || !prDetail || !review.inlineCommentTarget || !body || review.postingInlineComment) return
    review.setPostingInlineComment(true)
    review.setInlineCommentError(null)
    void ipc.github.addPrReviewComment(selectedRow.repoPath, selectedRow.item.number, {
      body,
      commitId: prDetail.item.headRefOid,
      path: review.inlineCommentTarget.path,
      side: review.inlineCommentTarget.side,
      line: review.inlineCommentTarget.line,
    })
      .then((comment: unknown) => {
        setPrDetail((current) => current ? { ...current, comments: [...current.comments, comment as PrReviewComment] } : current)
        review.setInlineCommentTarget(null)
        review.setInlineCommentBody('')
      })
      .catch((error: unknown) => review.setInlineCommentError(ipc.cleanIpcError(error, t('errors.postInlineComment'))))
      .finally(() => review.setPostingInlineComment(false))
  }, [prDetail, review, selectedRow, setPrDetail, t])

  const handleToggleFileViewed = useCallback((file: GitHubPrFile, viewed: boolean) => {
    if (!selectedRow || selectedRow.item.type !== 'pr' || !prDetail?.item.pullRequestId || review.pendingViewedPaths.has(file.path)) return
    const previousState = file.viewedState
    review.setFileViewedPending(file.path, true)
    setPrDetail((current) => current ? { ...current, files: current.files.map((item) => item.path === file.path ? { ...item, viewedState: viewed ? 'VIEWED' : 'UNVIEWED' } : item) } : current)
    void ipc.github.setPrFileViewed(selectedRow.repoPath, selectedRow.item.number, prDetail.item.pullRequestId, file.path, viewed)
      .catch((error: unknown) => {
        setPrDetail((current) => current ? { ...current, files: current.files.map((item) => item.path === file.path ? { ...item, viewedState: previousState } : item) } : current)
        review.setCommentError(ipc.cleanIpcError(error, t('errors.updateFileViewed')))
      })
      .finally(() => review.setFileViewedPending(file.path, false))
  }, [prDetail, review, selectedRow, setPrDetail, t])

  const handleRerunChecks = useCallback((failedOnly: boolean) => {
    if (!selectedRow || selectedRow.item.type !== 'pr' || !prDetail || review.checkActionBusy) return
    const check = failedOnly ? prDetail.checks.find((item) => getCheckState(item) === 'failure' && item.url) : prDetail.checks.find((item) => item.url)
    if (!check?.url) return
    review.setCheckActionBusy(failedOnly ? 'failed' : 'all')
    review.setPrActionError(null)
    void ipc.github.rerunCheck(selectedRow.repoPath, check.url, failedOnly)
      .then(() => ipc.github.getPrDetail(selectedRow.repoPath, selectedRow.item.number, true).then((detail: unknown) => setPrDetail(detail as GitHubPrDetail)))
      .catch((error: unknown) => review.setPrActionError(ipc.cleanIpcError(error, t('errors.rerunChecks'))))
      .finally(() => review.setCheckActionBusy(null))
  }, [prDetail, review, selectedRow, setPrDetail, t])

  return { handleSubmitInlineComment, handleToggleFileViewed, handleRerunChecks }
}
