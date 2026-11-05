// Typed GitHub IPC wrappers (ipc.github), split out of ipc.ts.


const api = () => window.api

export const github = {
  getPrStatus: (worktreePath: string, forceRefresh?: boolean) =>
    api().github.getPrStatus(worktreePath, forceRefresh),
  listWorkItems: (repoPath: string, limit?: number, query?: string, forceRefresh?: boolean) =>
    api().github.listWorkItems(repoPath, limit, query, forceRefresh),
  countWorkItems: (repoPath: string, query?: string, forceRefresh?: boolean) =>
    api().github.countWorkItems(repoPath, query, forceRefresh),
  getPrDetail: (repoPath: string, number: number, forceRefresh?: boolean) =>
    api().github.getPrDetail(repoPath, number, forceRefresh),
  getPrSummary: (repoPath: string, number: number, forceRefresh?: boolean) =>
    api().github.getPrSummary(repoPath, number, forceRefresh),
  listReviewerSuggestions: (repoPath: string, query?: string, limit?: number, forceRefresh?: boolean) =>
    api().github.listReviewerSuggestions(repoPath, query, limit, forceRefresh),
  listLabelSuggestions: (repoPath: string, query?: string, limit?: number, forceRefresh?: boolean) =>
    api().github.listLabelSuggestions(repoPath, query, limit, forceRefresh),
  addPrComment: (repoPath: string, number: number, body: string) =>
    api().github.addPrComment(repoPath, number, body),
  replyToPrReviewComment: (repoPath: string, number: number, commentId: number, body: string) =>
    api().github.replyToPrReviewComment(repoPath, number, commentId, body),
  addPrReviewComment: (repoPath: string, number: number, args: { body: string; commitId: string; path: string; side: 'LEFT' | 'RIGHT'; line: number }) =>
    api().github.addPrReviewComment(repoPath, number, args),
  submitPrReview: (repoPath: string, number: number, event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES', body?: string) =>
    api().github.submitPrReview(repoPath, number, event, body),
  resolvePrReviewThread: (repoPath: string, number: number, threadId: string, resolve: boolean) =>
    api().github.resolvePrReviewThread(repoPath, number, threadId, resolve),
  setPrFileViewed: (repoPath: string, number: number, pullRequestId: string, path: string, viewed: boolean) =>
    api().github.setPrFileViewed(repoPath, number, pullRequestId, path, viewed),
  getPrFilePreview: (repoPath: string, number: number, path: string, ref: string) =>
    api().github.getPrFilePreview(repoPath, number, path, ref),
  requestPrReviewer: (repoPath: string, number: number, reviewer: string) =>
    api().github.requestPrReviewer(repoPath, number, reviewer),
  removePrReviewer: (repoPath: string, number: number, reviewer: string) =>
    api().github.removePrReviewer(repoPath, number, reviewer),
  addPrLabel: (repoPath: string, number: number, label: string) =>
    api().github.addPrLabel(repoPath, number, label),
  removePrLabel: (repoPath: string, number: number, label: string) =>
    api().github.removePrLabel(repoPath, number, label),
  rerunCheck: (repoPath: string, checkUrl: string, failedOnly: boolean) =>
    api().github.rerunCheck(repoPath, checkUrl, failedOnly),
  toggleReaction: (repoPath: string, number: number, subjectId: string, content: string, reacted: boolean) =>
    api().github.toggleReaction(repoPath, number, subjectId, content, reacted),
  getChecks: (worktreePath: string, forceRefresh?: boolean) =>
    api().github.getChecks(worktreePath, forceRefresh),
  getDeployments: (worktreePath: string, forceRefresh?: boolean) =>
    api().github.getDeployments(worktreePath, forceRefresh),
  getOwnerAvatarUrl: (cwd: string): Promise<string> =>
    api().github.getOwnerAvatarUrl(cwd),
  getGitSyncStatus: (worktreePath: string, baseBranch: string, forceRefresh?: boolean) =>
    api().github.getGitSyncStatus(worktreePath, baseBranch, forceRefresh),
  getCheckRunLog: (worktreePath: string, checkUrl: string) =>
    api().github.getCheckRunLog(worktreePath, checkUrl),
  openCheckLog: (worktreePath: string, checkUrl: string, checkName: string) =>
    api().github.openCheckLog(worktreePath, checkUrl, checkName),
  mergePr: (worktreePath: string, strategy: 'merge' | 'squash' | 'rebase') =>
    api().github.mergePr(worktreePath, strategy),
  markPrReady: (worktreePath: string) =>
    api().github.markPrReady(worktreePath),
  mergePrByNumber: (repoPath: string, number: number, strategy: 'merge' | 'squash' | 'rebase') =>
    api().github.mergePrByNumber(repoPath, number, strategy),
  closePrByNumber: (repoPath: string, number: number) =>
    api().github.closePrByNumber(repoPath, number),
  markPrReadyByNumber: (repoPath: string, number: number) =>
    api().github.markPrReadyByNumber(repoPath, number),
  getReviews: (worktreePath: string, forceRefresh?: boolean) =>
    api().github.getReviews(worktreePath, forceRefresh),
  replyToReviewComment: (worktreePath: string, commentId: number, body: string) =>
    api().github.replyToReviewComment(worktreePath, commentId, body),
  startDeviceFlow: () =>
    api().github.startDeviceFlow(),
  cancelDeviceFlow: () =>
    api().github.cancelDeviceFlow(),
  feedGhToken: (token: string) =>
    api().github.feedGhToken(token),
  onDeviceFlowEvent: (callback: (event: { status: string; token?: string; error?: string }) => void) =>
    api().github.onDeviceFlowEvent(callback),
}
