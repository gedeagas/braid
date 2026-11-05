// github bridge (window.api.github). Split out of preload/index.ts.

import { ipcRenderer } from 'electron'

export const githubBridge = {
  getPrStatus: (worktreePath: string, forceRefresh?: boolean) =>
    ipcRenderer.invoke('github:getPrStatus', worktreePath, forceRefresh),
  listWorkItems: (repoPath: string, limit?: number, query?: string, forceRefresh?: boolean) =>
    ipcRenderer.invoke('github:listWorkItems', repoPath, limit, query, forceRefresh),
  countWorkItems: (repoPath: string, query?: string, forceRefresh?: boolean) =>
    ipcRenderer.invoke('github:countWorkItems', repoPath, query, forceRefresh),
  getPrDetail: (repoPath: string, number: number, forceRefresh?: boolean) =>
    ipcRenderer.invoke('github:getPrDetail', repoPath, number, forceRefresh),
  getPrSummary: (repoPath: string, number: number, forceRefresh?: boolean) =>
    ipcRenderer.invoke('github:getPrSummary', repoPath, number, forceRefresh),
  listReviewerSuggestions: (repoPath: string, query?: string, limit?: number, forceRefresh?: boolean) =>
    ipcRenderer.invoke('github:listReviewerSuggestions', repoPath, query, limit, forceRefresh),
  listLabelSuggestions: (repoPath: string, query?: string, limit?: number, forceRefresh?: boolean) =>
    ipcRenderer.invoke('github:listLabelSuggestions', repoPath, query, limit, forceRefresh),
  addPrComment: (repoPath: string, number: number, body: string) =>
    ipcRenderer.invoke('github:addPrComment', repoPath, number, body),
  replyToPrReviewComment: (repoPath: string, number: number, commentId: number, body: string) =>
    ipcRenderer.invoke('github:replyToPrReviewComment', repoPath, number, commentId, body),
  addPrReviewComment: (repoPath: string, number: number, args: { body: string; commitId: string; path: string; side: 'LEFT' | 'RIGHT'; line: number }) =>
    ipcRenderer.invoke('github:addPrReviewComment', repoPath, number, args),
  submitPrReview: (repoPath: string, number: number, event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES', body?: string) =>
    ipcRenderer.invoke('github:submitPrReview', repoPath, number, event, body),
  resolvePrReviewThread: (repoPath: string, number: number, threadId: string, resolve: boolean) =>
    ipcRenderer.invoke('github:resolvePrReviewThread', repoPath, number, threadId, resolve),
  setPrFileViewed: (repoPath: string, number: number, pullRequestId: string, path: string, viewed: boolean) =>
    ipcRenderer.invoke('github:setPrFileViewed', repoPath, number, pullRequestId, path, viewed),
  getPrFilePreview: (repoPath: string, number: number, path: string, ref: string) =>
    ipcRenderer.invoke('github:getPrFilePreview', repoPath, number, path, ref),
  requestPrReviewer: (repoPath: string, number: number, reviewer: string) =>
    ipcRenderer.invoke('github:requestPrReviewer', repoPath, number, reviewer),
  removePrReviewer: (repoPath: string, number: number, reviewer: string) =>
    ipcRenderer.invoke('github:removePrReviewer', repoPath, number, reviewer),
  addPrLabel: (repoPath: string, number: number, label: string) =>
    ipcRenderer.invoke('github:addPrLabel', repoPath, number, label),
  removePrLabel: (repoPath: string, number: number, label: string) =>
    ipcRenderer.invoke('github:removePrLabel', repoPath, number, label),
  rerunCheck: (repoPath: string, checkUrl: string, failedOnly: boolean) =>
    ipcRenderer.invoke('github:rerunCheck', repoPath, checkUrl, failedOnly),
  toggleReaction: (repoPath: string, number: number, subjectId: string, content: string, reacted: boolean) =>
    ipcRenderer.invoke('github:toggleReaction', repoPath, number, subjectId, content, reacted),
  getChecks: (worktreePath: string, forceRefresh?: boolean) =>
    ipcRenderer.invoke('github:getChecks', worktreePath, forceRefresh),
  getDeployments: (worktreePath: string, forceRefresh?: boolean) =>
    ipcRenderer.invoke('github:getDeployments', worktreePath, forceRefresh),
  getOwnerAvatarUrl: (cwd: string) =>
    ipcRenderer.invoke('github:getOwnerAvatarUrl', cwd) as Promise<string>,
  getGitSyncStatus: (worktreePath: string, baseBranch: string, forceRefresh?: boolean) =>
    ipcRenderer.invoke('github:getGitSyncStatus', worktreePath, baseBranch, forceRefresh),
  getCheckRunLog: (worktreePath: string, checkUrl: string) =>
    ipcRenderer.invoke('github:getCheckRunLog', worktreePath, checkUrl),
  openCheckLog: (worktreePath: string, checkUrl: string, checkName: string) =>
    ipcRenderer.invoke('github:openCheckLog', worktreePath, checkUrl, checkName),
  mergePr: (worktreePath: string, strategy: string) =>
    ipcRenderer.invoke('github:mergePr', worktreePath, strategy),
  markPrReady: (worktreePath: string) =>
    ipcRenderer.invoke('github:markPrReady', worktreePath),
  mergePrByNumber: (repoPath: string, number: number, strategy: string) =>
    ipcRenderer.invoke('github:mergePrByNumber', repoPath, number, strategy),
  closePrByNumber: (repoPath: string, number: number) =>
    ipcRenderer.invoke('github:closePrByNumber', repoPath, number),
  markPrReadyByNumber: (repoPath: string, number: number) =>
    ipcRenderer.invoke('github:markPrReadyByNumber', repoPath, number),
  getReviews: (worktreePath: string, forceRefresh?: boolean) =>
    ipcRenderer.invoke('github:getReviews', worktreePath, forceRefresh),
  replyToReviewComment: (worktreePath: string, commentId: number, body: string) =>
    ipcRenderer.invoke('github:replyToReviewComment', worktreePath, commentId, body) as Promise<void>,
  startDeviceFlow: () =>
    ipcRenderer.invoke('github:startDeviceFlow') as Promise<{
      userCode: string; verificationUri: string; expiresIn: number
    }>,
  cancelDeviceFlow: () => ipcRenderer.invoke('github:cancelDeviceFlow'),
  feedGhToken: (token: string) =>
    ipcRenderer.invoke('github:feedGhToken', token) as Promise<{ success: boolean }>,
  onDeviceFlowEvent: (callback: (event: { status: string; token?: string; error?: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { status: string; token?: string; error?: string }) => callback(data)
    ipcRenderer.on('github:deviceFlowEvent', handler)
    return () => { ipcRenderer.removeListener('github:deviceFlowEvent', handler) }
  },
}
