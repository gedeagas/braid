// Git IPC handlers, split out of ipc.ts.

import { ipcMain } from 'electron'
import { writeFile } from 'fs/promises'
import { gitService } from '../services/git'
import { notesService } from '../services/notes'
import { mainSettings } from '../ipc'

export function registerGitIpc(): void {
  // Git
  ipcMain.handle('git:getWorktrees', (_e, repoPath: string) => gitService.getWorktrees(repoPath))
  ipcMain.handle('git:addWorktree', (_e, repoPath: string, branch: string, projectName: string, baseBranch?: string) =>
    gitService.addWorktree(repoPath, branch, projectName, baseBranch, mainSettings.worktreeStoragePath || undefined)
  )
  ipcMain.handle('git:removeWorktree', (_e, repoPath: string, worktreePath: string, worktreeId?: string) => {
    if (worktreeId) notesService.delete(worktreeId)
    return gitService.removeWorktree(repoPath, worktreePath)
  })
  ipcMain.handle('git:getBranches', (_e, repoPath: string) => gitService.getBranches(repoPath))
  ipcMain.handle('git:getStatus', (_e, worktreePath: string) => gitService.getStatus(worktreePath))
  ipcMain.handle('git:getDiff', (_e, worktreePath: string) => gitService.getDiff(worktreePath))
  ipcMain.handle('git:getFileDiff', (_e, worktreePath: string, file: string, status: string, staged: boolean) =>
    gitService.getFileDiff(worktreePath, file, status, staged)
  )
  ipcMain.handle('git:getFileTree', (_e, worktreePath: string, _subPath?: string, forceRefresh?: boolean) =>
    gitService.getFileTree(worktreePath, '', forceRefresh))
  ipcMain.handle('git:invalidateFileTree', (_e, worktreePath: string) => gitService.invalidateFileTree(worktreePath))
  ipcMain.handle('git:invalidateTrackedFiles', (_e, worktreePath: string) => gitService.invalidateTrackedFiles(worktreePath))
  ipcMain.handle('git:readFile', (_e, filePath: string) => gitService.readFile(filePath))
  ipcMain.handle('git:readFileAsBase64', (_e, filePath: string) => gitService.readFileAsBase64(filePath))
  ipcMain.handle('git:getFileSize', (_e, filePath: string) => gitService.getFileSize(filePath))
  ipcMain.handle('git:writeFile', (_e, filePath: string, content: string) => gitService.writeFile(filePath, content))
  ipcMain.handle('git:getTrackingBranch', (_e, worktreePath: string, branch: string) =>
    gitService.getTrackingBranch(worktreePath, branch)
  )
  ipcMain.handle('git:getRemoteBranches', (_e, worktreePath: string, forceRefresh?: boolean) =>
    gitService.getRemoteBranches(worktreePath, forceRefresh)
  )
  ipcMain.handle('git:getRemoteUrl', (_e, repoPath: string) =>
    gitService.getRemoteUrl(repoPath)
  )
  ipcMain.handle('git:renameBranch', (_e, worktreePath: string, oldName: string, newName: string) =>
    gitService.renameBranch(worktreePath, oldName, newName)
  )
  ipcMain.handle('git:setUpstream', (_e, worktreePath: string, branch: string, upstream: string) =>
    gitService.setUpstream(worktreePath, branch, upstream)
  )
  ipcMain.handle('git:isBranchProtected', (_e, worktreePath: string, branch: string) =>
    gitService.isBranchProtected(worktreePath, branch)
  )
  ipcMain.handle('git:cloneRepo', (_e, url: string) => gitService.cloneRepo(url, mainSettings.worktreeStoragePath || undefined))
  ipcMain.handle('git:stageFiles', (_e, worktreePath: string, files: string[]) =>
    gitService.stageFiles(worktreePath, files)
  )
  ipcMain.handle('git:unstageFiles', (_e, worktreePath: string, files: string[]) =>
    gitService.unstageFiles(worktreePath, files)
  )
  ipcMain.handle('git:discardChanges', (_e, worktreePath: string, file: string, status: string, staged?: boolean) =>
    gitService.discardChanges(worktreePath, file, status, staged)
  )
  ipcMain.handle('git:commit', (_e, worktreePath: string, message: string) =>
    gitService.commit(worktreePath, message)
  )
  ipcMain.handle('git:pull', (_e, worktreePath: string, strategy?: string) =>
    gitService.pull(worktreePath, strategy as 'rebase' | 'merge' | undefined)
  )
  ipcMain.handle('git:push', (_e, worktreePath: string) => gitService.push(worktreePath))
  ipcMain.handle('git:getTrackedFiles', (_e, worktreePath: string) => gitService.getTrackedFiles(worktreePath))
  ipcMain.handle('git:getRemotes', (_e, repoPath: string) => gitService.getRemotes(repoPath))
  ipcMain.handle('git:getGitUserConfig', (_e, repoPath: string) => gitService.getGitUserConfig(repoPath))
  ipcMain.handle('git:setGitUserConfig', (_e, repoPath: string, name: string, email: string) =>
    gitService.setGitUserConfig(repoPath, name, email)
  )
  ipcMain.handle('git:clearGitUserConfig', (_e, repoPath: string) => gitService.clearGitUserConfig(repoPath))
  ipcMain.handle('git:initRepo', (_e, dirPath: string) => gitService.initRepo(dirPath))
  ipcMain.handle('git:isRepoRoot', (_e, repoPath: string) => gitService.isRepoRoot(repoPath))
  ipcMain.handle('git:findChildRepos', (_e, parentPath: string) => gitService.findChildRepos(parentPath))
  ipcMain.handle('git:createSnapshot', (_e, worktreePath: string) => gitService.createSnapshot(worktreePath))
  ipcMain.handle('git:restoreSnapshot', (_e, worktreePath: string, snapSha: string) =>
    gitService.restoreSnapshot(worktreePath, snapSha)
  )
}
