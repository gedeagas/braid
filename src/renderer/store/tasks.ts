import { create } from 'zustand'

import type { PRCommentAudienceFilter } from '../../shared/pr-comment-audience'

export type TaskActivityFilter = PRCommentAudienceFilter
export type TaskDetailTab = 'description' | 'files'
export type TaskPrAction = 'ready' | 'merge' | 'squash' | 'rebase' | 'close'
export type TaskReviewSubmitAction = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'
export type TaskDiffViewMode = 'unified' | 'split'

export interface TaskInlineCommentTarget {
  path: string
  line: number
  side: 'LEFT' | 'RIGHT'
  preview: string
}

export interface TasksReviewState {
  prCommentBody: string
  postingPrComment: boolean
  commentError: string | null
  replyingCommentId: number | null
  replyBody: string
  postingReplyId: number | null
  activityFilter: TaskActivityFilter
  detailTab: TaskDetailTab
  selectedFilePath: string | null
  inlineCommentTarget: TaskInlineCommentTarget | null
  inlineCommentBody: string
  postingInlineComment: boolean
  inlineCommentError: string | null
  reviewSubmitOpen: boolean
  reviewSubmitBody: string
  reviewSubmitBusy: TaskReviewSubmitAction | null
  reviewSubmitError: string | null
  prActionBusy: TaskPrAction | null
  prActionError: string | null
  resolvingThreadIds: Set<string>
  reactingSubjectIds: Set<string>
  pendingViewedPaths: Set<string>
  creatingWorktreeForRowId: string | null
  checkActionBusy: 'failed' | 'all' | null
  diffViewMode: TaskDiffViewMode
  diffSearch: string
  diffSearchMatchIndex: number
  reviewerDraft: string
  reviewerBusy: string | null
  reviewerError: string | null
  labelDraft: string
  labelBusy: string | null
  labelError: string | null
  filePreviewLoadingPath: string | null
  expandedDiffCommentIds: Set<number>
  setPrCommentBody: (value: string) => void
  setPostingPrComment: (value: boolean) => void
  setCommentError: (value: string | null) => void
  setReplyingCommentId: (value: number | null | ((current: number | null) => number | null)) => void
  setReplyBody: (value: string) => void
  setPostingReplyId: (value: number | null) => void
  setActivityFilter: (value: TaskActivityFilter) => void
  setDetailTab: (value: TaskDetailTab) => void
  setSelectedFilePath: (value: string | null | ((current: string | null) => string | null)) => void
  setInlineCommentTarget: (value: TaskInlineCommentTarget | null) => void
  setInlineCommentBody: (value: string) => void
  setPostingInlineComment: (value: boolean) => void
  setInlineCommentError: (value: string | null) => void
  setReviewSubmitOpen: (value: boolean) => void
  setReviewSubmitBody: (value: string) => void
  setReviewSubmitBusy: (value: TaskReviewSubmitAction | null) => void
  setReviewSubmitError: (value: string | null) => void
  setPrActionBusy: (value: TaskPrAction | null) => void
  setPrActionError: (value: string | null) => void
  setThreadResolving: (threadId: string, resolving: boolean) => void
  setReactionPending: (subjectId: string, pending: boolean) => void
  setFileViewedPending: (path: string, pending: boolean) => void
  setCreatingWorktreeForRowId: (value: string | null) => void
  setCheckActionBusy: (value: 'failed' | 'all' | null) => void
  setDiffViewMode: (value: TaskDiffViewMode) => void
  setDiffSearch: (value: string) => void
  setDiffSearchMatchIndex: (value: number | ((current: number) => number)) => void
  setReviewerDraft: (value: string) => void
  setReviewerBusy: (value: string | null) => void
  setReviewerError: (value: string | null) => void
  setLabelDraft: (value: string) => void
  setLabelBusy: (value: string | null) => void
  setLabelError: (value: string | null) => void
  setFilePreviewLoadingPath: (value: string | null) => void
  toggleDiffExpansion: (commentId: number) => void
  resetPrDetailUi: () => void
}

const defaultReviewState = {
  prCommentBody: '',
  postingPrComment: false,
  commentError: null,
  replyingCommentId: null,
  replyBody: '',
  postingReplyId: null,
  activityFilter: 'all' as TaskActivityFilter,
  detailTab: 'description' as TaskDetailTab,
  selectedFilePath: null,
  inlineCommentTarget: null,
  inlineCommentBody: '',
  postingInlineComment: false,
  inlineCommentError: null,
  reviewSubmitOpen: false,
  reviewSubmitBody: '',
  reviewSubmitBusy: null,
  reviewSubmitError: null,
  prActionBusy: null,
  prActionError: null,
  resolvingThreadIds: new Set<string>(),
  reactingSubjectIds: new Set<string>(),
  pendingViewedPaths: new Set<string>(),
  creatingWorktreeForRowId: null,
  checkActionBusy: null,
  diffViewMode: 'unified' as TaskDiffViewMode,
  diffSearch: '',
  diffSearchMatchIndex: 0,
  reviewerDraft: '',
  reviewerBusy: null,
  reviewerError: null,
  labelDraft: '',
  labelBusy: null,
  labelError: null,
  filePreviewLoadingPath: null,
  expandedDiffCommentIds: new Set<number>(),
}

export const useTasksReviewStore = create<TasksReviewState>((set) => ({
  ...defaultReviewState,
  setPrCommentBody: (prCommentBody) => set({ prCommentBody }),
  setPostingPrComment: (postingPrComment) => set({ postingPrComment }),
  setCommentError: (commentError) => set({ commentError }),
  setReplyingCommentId: (value) => set((state) => ({
    replyingCommentId: typeof value === 'function' ? value(state.replyingCommentId) : value,
  })),
  setReplyBody: (replyBody) => set({ replyBody }),
  setPostingReplyId: (postingReplyId) => set({ postingReplyId }),
  setActivityFilter: (activityFilter) => set({ activityFilter }),
  setDetailTab: (detailTab) => set({ detailTab }),
  setSelectedFilePath: (value) => set((state) => ({
    selectedFilePath: typeof value === 'function' ? value(state.selectedFilePath) : value,
  })),
  setInlineCommentTarget: (inlineCommentTarget) => set({ inlineCommentTarget }),
  setInlineCommentBody: (inlineCommentBody) => set({ inlineCommentBody }),
  setPostingInlineComment: (postingInlineComment) => set({ postingInlineComment }),
  setInlineCommentError: (inlineCommentError) => set({ inlineCommentError }),
  setReviewSubmitOpen: (reviewSubmitOpen) => set({ reviewSubmitOpen }),
  setReviewSubmitBody: (reviewSubmitBody) => set({ reviewSubmitBody }),
  setReviewSubmitBusy: (reviewSubmitBusy) => set({ reviewSubmitBusy }),
  setReviewSubmitError: (reviewSubmitError) => set({ reviewSubmitError }),
  setPrActionBusy: (prActionBusy) => set({ prActionBusy }),
  setPrActionError: (prActionError) => set({ prActionError }),
  setThreadResolving: (threadId, resolving) => set((state) => {
    const resolvingThreadIds = new Set(state.resolvingThreadIds)
    if (resolving) resolvingThreadIds.add(threadId)
    else resolvingThreadIds.delete(threadId)
    return { resolvingThreadIds }
  }),
  setReactionPending: (subjectId, pending) => set((state) => {
    const reactingSubjectIds = new Set(state.reactingSubjectIds)
    if (pending) reactingSubjectIds.add(subjectId)
    else reactingSubjectIds.delete(subjectId)
    return { reactingSubjectIds }
  }),
  setFileViewedPending: (path, pending) => set((state) => {
    const pendingViewedPaths = new Set(state.pendingViewedPaths)
    if (pending) pendingViewedPaths.add(path)
    else pendingViewedPaths.delete(path)
    return { pendingViewedPaths }
  }),
  setCreatingWorktreeForRowId: (creatingWorktreeForRowId) => set({ creatingWorktreeForRowId }),
  setCheckActionBusy: (checkActionBusy) => set({ checkActionBusy }),
  setDiffViewMode: (diffViewMode) => set({ diffViewMode }),
  setDiffSearch: (diffSearch) => set({ diffSearch, diffSearchMatchIndex: 0 }),
  setDiffSearchMatchIndex: (value) => set((state) => ({
    diffSearchMatchIndex: typeof value === 'function' ? value(state.diffSearchMatchIndex) : value,
  })),
  setReviewerDraft: (reviewerDraft) => set({ reviewerDraft }),
  setReviewerBusy: (reviewerBusy) => set({ reviewerBusy }),
  setReviewerError: (reviewerError) => set({ reviewerError }),
  setLabelDraft: (labelDraft) => set({ labelDraft }),
  setLabelBusy: (labelBusy) => set({ labelBusy }),
  setLabelError: (labelError) => set({ labelError }),
  setFilePreviewLoadingPath: (filePreviewLoadingPath) => set({ filePreviewLoadingPath }),
  toggleDiffExpansion: (commentId) => set((state) => {
    const expandedDiffCommentIds = new Set(state.expandedDiffCommentIds)
    if (expandedDiffCommentIds.has(commentId)) expandedDiffCommentIds.delete(commentId)
    else expandedDiffCommentIds.add(commentId)
    return { expandedDiffCommentIds }
  }),
  resetPrDetailUi: () => set({
    ...defaultReviewState,
    resolvingThreadIds: new Set<string>(),
    reactingSubjectIds: new Set<string>(),
    pendingViewedPaths: new Set<string>(),
    expandedDiffCommentIds: new Set<number>(),
  }),
}))
