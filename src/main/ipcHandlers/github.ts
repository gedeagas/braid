// GitHub, GitHub OAuth and Jira IPC handlers, split out of ipc.ts.

import { ipcMain } from 'electron'
import { writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { githubService, type GitHubReactionContent } from '../services/github'
import { jiraService } from '../services/jira'
import { githubAuthService } from '../services/githubAuth'

export function registerGithubIpc(): void {
  // GitHub
  ipcMain.handle('github:getPrStatus', (_e, worktreePath: string, forceRefresh?: boolean) =>
    githubService.getPrStatus(worktreePath, forceRefresh))
  ipcMain.handle('github:listWorkItems', (_e, repoPath: string, limit?: number, query?: string, forceRefresh?: boolean) =>
    githubService.listWorkItems(repoPath, limit, query, forceRefresh))
  ipcMain.handle('github:countWorkItems', (_e, repoPath: string, query?: string, forceRefresh?: boolean) =>
    githubService.countWorkItems(repoPath, query, forceRefresh))
  ipcMain.handle('github:getPrDetail', (_e, repoPath: string, number: number, forceRefresh?: boolean) =>
    githubService.getPrDetail(repoPath, number, forceRefresh))
  ipcMain.handle('github:getPrSummary', (_e, repoPath: string, number: number, forceRefresh?: boolean) =>
    githubService.getPrSummary(repoPath, number, forceRefresh))
  ipcMain.handle('github:listReviewerSuggestions', (_e, repoPath: string, query?: string, limit?: number, forceRefresh?: boolean) =>
    githubService.listReviewerSuggestions(repoPath, query, limit, forceRefresh))
  ipcMain.handle('github:listLabelSuggestions', (_e, repoPath: string, query?: string, limit?: number, forceRefresh?: boolean) =>
    githubService.listLabelSuggestions(repoPath, query, limit, forceRefresh))
  ipcMain.handle('github:addPrComment', (_e, repoPath: string, number: number, body: string) =>
    githubService.addPrComment(repoPath, number, body))
  ipcMain.handle('github:replyToPrReviewComment', (_e, repoPath: string, number: number, commentId: number, body: string) =>
    githubService.replyToPrReviewComment(repoPath, number, commentId, body))
  ipcMain.handle('github:addPrReviewComment', (_e, repoPath: string, number: number, args: { body: string; commitId: string; path: string; side: 'LEFT' | 'RIGHT'; line: number }) =>
    githubService.addPrReviewComment(repoPath, number, args))
  ipcMain.handle('github:submitPrReview', (_e, repoPath: string, number: number, event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES', body?: string) =>
    githubService.submitPrReview(repoPath, number, event, body))
  ipcMain.handle('github:resolvePrReviewThread', (_e, repoPath: string, number: number, threadId: string, resolve: boolean) =>
    githubService.resolvePrReviewThread(repoPath, number, threadId, resolve))
  ipcMain.handle('github:setPrFileViewed', (_e, repoPath: string, number: number, pullRequestId: string, path: string, viewed: boolean) =>
    githubService.setPrFileViewed(repoPath, number, pullRequestId, path, viewed))
  ipcMain.handle('github:getPrFilePreview', (_e, repoPath: string, number: number, path: string, ref: string) =>
    githubService.getPrFilePreview(repoPath, number, path, ref))
  ipcMain.handle('github:requestPrReviewer', (_e, repoPath: string, number: number, reviewer: string) =>
    githubService.requestPrReviewer(repoPath, number, reviewer))
  ipcMain.handle('github:removePrReviewer', (_e, repoPath: string, number: number, reviewer: string) =>
    githubService.removePrReviewer(repoPath, number, reviewer))
  ipcMain.handle('github:addPrLabel', (_e, repoPath: string, number: number, label: string) =>
    githubService.addPrLabel(repoPath, number, label))
  ipcMain.handle('github:removePrLabel', (_e, repoPath: string, number: number, label: string) =>
    githubService.removePrLabel(repoPath, number, label))
  ipcMain.handle('github:rerunCheck', (_e, repoPath: string, checkUrl: string, failedOnly: boolean) =>
    githubService.rerunCheck(repoPath, checkUrl, failedOnly))
  ipcMain.handle('github:toggleReaction', (_e, repoPath: string, number: number, subjectId: string, content: string, reacted: boolean) =>
    githubService.toggleReaction(repoPath, number, subjectId, content as GitHubReactionContent, reacted))
  ipcMain.handle('github:getChecks', (_e, worktreePath: string, forceRefresh?: boolean) =>
    githubService.getChecks(worktreePath, forceRefresh))
  ipcMain.handle('github:getDeployments', (_e, worktreePath: string, forceRefresh?: boolean) =>
    githubService.getDeployments(worktreePath, forceRefresh))
  ipcMain.handle('github:getOwnerAvatarUrl', (_e, cwd: string) =>
    githubService.getOwnerAvatarUrl(cwd))
  ipcMain.handle('github:getGitSyncStatus', (_e, worktreePath: string, baseBranch: string, forceRefresh?: boolean) =>
    githubService.getGitSyncStatus(worktreePath, baseBranch, forceRefresh)
  )
  ipcMain.handle('github:mergePr', (_e, worktreePath: string, strategy: string) =>
    githubService.mergePr(worktreePath, strategy as 'merge' | 'squash' | 'rebase')
  )
  ipcMain.handle('github:markPrReady', (_e, worktreePath: string) =>
    githubService.markPrReady(worktreePath)
  )
  ipcMain.handle('github:mergePrByNumber', (_e, repoPath: string, number: number, strategy: string) =>
    githubService.mergePrByNumber(repoPath, number, strategy as 'merge' | 'squash' | 'rebase')
  )
  ipcMain.handle('github:closePrByNumber', (_e, repoPath: string, number: number) =>
    githubService.closePrByNumber(repoPath, number)
  )
  ipcMain.handle('github:markPrReadyByNumber', (_e, repoPath: string, number: number) =>
    githubService.markPrReadyByNumber(repoPath, number)
  )
  ipcMain.handle('github:getCheckRunLog', (_e, worktreePath: string, checkUrl: string) =>
    githubService.getCheckRunLog(worktreePath, checkUrl)
  )
  ipcMain.handle('github:getReviews', (_e, worktreePath: string, forceRefresh?: boolean) =>
    githubService.getReviews(worktreePath, forceRefresh)
  )
  ipcMain.handle('github:replyToReviewComment', (_e, worktreePath: string, commentId: number, body: string) =>
    githubService.replyToReviewComment(worktreePath, commentId, body)
  )
  ipcMain.handle('github:openCheckLog', async (_e, worktreePath: string, checkUrl: string, checkName: string) => {
    const log = await githubService.getCheckRunLog(worktreePath, checkUrl)
    const safe = checkName.replace(/[^a-zA-Z0-9-_]/g, '_')
    const tmpPath = join(tmpdir(), `ci-log-${safe}.log`)
    await writeFile(tmpPath, log || '(no log output)', 'utf8')
    return tmpPath
  })

  // GitHub Device Flow OAuth
  ipcMain.handle('github:startDeviceFlow', async () => {
    const code = await githubAuthService.requestDeviceCode()
    githubAuthService.startPolling(code.device_code, code.interval, code.expires_in)
    return { userCode: code.user_code, verificationUri: code.verification_uri, expiresIn: code.expires_in }
  })
  ipcMain.handle('github:cancelDeviceFlow', () => githubAuthService.cancel())
  ipcMain.handle('github:feedGhToken', async (_e, token: string) => ({
    success: await githubAuthService.feedTokenToGh(token),
  }))

  // Jira (optional — only available if acli is installed)
  ipcMain.handle('jira:isAvailable', () => jiraService.isAvailable())
  ipcMain.handle('jira:recheckAvailability', () => jiraService.recheckAvailability())
  ipcMain.handle('jira:getIssuesForBranch', (_e, worktreePath: string, overrideBaseUrl?: string, forceRefresh?: boolean) =>
    jiraService.getIssuesForBranch(worktreePath, overrideBaseUrl, forceRefresh)
  )
  ipcMain.handle('jira:getIssueByKey', (_e, key: string, overrideBaseUrl?: string, forceRefresh?: boolean, includeContext?: boolean) =>
    jiraService.getIssueByKey(key, overrideBaseUrl, forceRefresh, includeContext)
  )
  ipcMain.handle('jira:invalidateCache', (_e, key?: string) => jiraService.invalidateCache(key))
}
