// git bridge (window.api.git). Split out of preload/index.ts.

import { ipcRenderer } from 'electron'

export const gitBridge = {
  getWorktrees: (repoPath: string) => ipcRenderer.invoke('git:getWorktrees', repoPath),
  addWorktree: (repoPath: string, branch: string, projectName: string, baseBranch?: string) =>
    ipcRenderer.invoke('git:addWorktree', repoPath, branch, projectName, baseBranch),
  removeWorktree: (repoPath: string, worktreePath: string) =>
    ipcRenderer.invoke('git:removeWorktree', repoPath, worktreePath),
  getBranches: (repoPath: string) => ipcRenderer.invoke('git:getBranches', repoPath),
  getStatus: (worktreePath: string) => ipcRenderer.invoke('git:getStatus', worktreePath),
  getDiff: (worktreePath: string) => ipcRenderer.invoke('git:getDiff', worktreePath),
  getFileDiff: (worktreePath: string, file: string, status: string, staged: boolean) =>
    ipcRenderer.invoke('git:getFileDiff', worktreePath, file, status, staged),
  getFileTree: (worktreePath: string, forceRefresh?: boolean) =>
    ipcRenderer.invoke('git:getFileTree', worktreePath, undefined, forceRefresh),
  invalidateFileTree: (worktreePath: string) => ipcRenderer.invoke('git:invalidateFileTree', worktreePath),
  invalidateTrackedFiles: (worktreePath: string) => ipcRenderer.invoke('git:invalidateTrackedFiles', worktreePath),
  readFile: (filePath: string) => ipcRenderer.invoke('git:readFile', filePath),
  readFileAsBase64: (filePath: string) =>
    ipcRenderer.invoke('git:readFileAsBase64', filePath) as Promise<{ base64: string | null; size: number } | null>,
  getFileSize: (filePath: string) =>
    ipcRenderer.invoke('git:getFileSize', filePath) as Promise<number>,
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('git:writeFile', filePath, content),
  getTrackingBranch: (worktreePath: string, branch: string) =>
    ipcRenderer.invoke('git:getTrackingBranch', worktreePath, branch),
  getRemoteBranches: (worktreePath: string, forceRefresh?: boolean) =>
    ipcRenderer.invoke('git:getRemoteBranches', worktreePath, forceRefresh) as Promise<{ branches: string[]; defaultBranch?: string }>,
  getRemoteUrl: (repoPath: string) =>
    ipcRenderer.invoke('git:getRemoteUrl', repoPath) as Promise<string>,
  getRemotes: (repoPath: string) =>
    ipcRenderer.invoke('git:getRemotes', repoPath) as Promise<Array<{ name: string; url: string }>>,
  renameBranch: (worktreePath: string, oldName: string, newName: string) =>
    ipcRenderer.invoke('git:renameBranch', worktreePath, oldName, newName),
  setUpstream: (worktreePath: string, branch: string, upstream: string) =>
    ipcRenderer.invoke('git:setUpstream', worktreePath, branch, upstream),
  isBranchProtected: (worktreePath: string, branch: string) =>
    ipcRenderer.invoke('git:isBranchProtected', worktreePath, branch),
  cloneRepo: (url: string) => ipcRenderer.invoke('git:cloneRepo', url),
  stageFiles: (worktreePath: string, files: string[]) =>
    ipcRenderer.invoke('git:stageFiles', worktreePath, files),
  unstageFiles: (worktreePath: string, files: string[]) =>
    ipcRenderer.invoke('git:unstageFiles', worktreePath, files),
  discardChanges: (worktreePath: string, file: string, status: string, staged?: boolean) =>
    ipcRenderer.invoke('git:discardChanges', worktreePath, file, status, staged),
  commit: (worktreePath: string, message: string) =>
    ipcRenderer.invoke('git:commit', worktreePath, message),
  pull: (worktreePath: string, strategy?: string) => ipcRenderer.invoke('git:pull', worktreePath, strategy),
  push: (worktreePath: string) => ipcRenderer.invoke('git:push', worktreePath),
  getTrackedFiles: (worktreePath: string) =>
    ipcRenderer.invoke('git:getTrackedFiles', worktreePath) as Promise<string[]>,
  getGitUserConfig: (repoPath: string) =>
    ipcRenderer.invoke('git:getGitUserConfig', repoPath) as Promise<{
      global: { name: string; email: string }
      local: { name: string | null; email: string | null }
    }>,
  setGitUserConfig: (repoPath: string, name: string, email: string) =>
    ipcRenderer.invoke('git:setGitUserConfig', repoPath, name, email) as Promise<void>,
  clearGitUserConfig: (repoPath: string) =>
    ipcRenderer.invoke('git:clearGitUserConfig', repoPath) as Promise<void>,
  initRepo: (dirPath: string) =>
    ipcRenderer.invoke('git:initRepo', dirPath) as Promise<void>,
  isRepoRoot: (repoPath: string) =>
    ipcRenderer.invoke('git:isRepoRoot', repoPath) as Promise<boolean>,
  findChildRepos: (parentPath: string) =>
    ipcRenderer.invoke('git:findChildRepos', parentPath) as Promise<string[]>,
  createSnapshot: (worktreePath: string) =>
    ipcRenderer.invoke('git:createSnapshot', worktreePath) as Promise<string>,
  restoreSnapshot: (worktreePath: string, snapSha: string) =>
    ipcRenderer.invoke('git:restoreSnapshot', worktreePath, snapSha) as Promise<void>,
}
