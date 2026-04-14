import { getWorktrees, addWorktree, removeWorktree, cloneRepo, parseRepoName } from './worktrees'
export type { CloneErrorCode } from './worktrees'
export { CloneError } from './worktrees'
import { getBranches, getRemoteBranches, setUpstream, renameBranch, getTrackingBranch, isBranchProtected } from './branches'
import { getStatus, getDiff, getFileDiff, getStagedDiff, getStagedFiles, getFileTree, getTrackedFiles, readFile, writeFile, readFileAsBase64, getFileSize, invalidateFileTree, invalidateTrackedFiles } from './status'
import { push, pull, stageFiles, unstageFiles, discardChanges, commit } from './operations'
import { getRemoteUrl, getRemotes, getGitUserConfig, setGitUserConfig, clearGitUserConfig, isRepoRoot, findChildRepos } from './config'

export type { WorktreeInfo, FileEntry, GitChangeInfo } from './types'
export { getWorktrees, addWorktree, removeWorktree, cloneRepo, parseRepoName }
export { getBranches, getRemoteBranches, setUpstream, renameBranch, getTrackingBranch, isBranchProtected }
export { getStatus, getDiff, getFileDiff, getStagedDiff, getStagedFiles, getFileTree, getTrackedFiles, readFile, writeFile, readFileAsBase64, getFileSize, invalidateFileTree, invalidateTrackedFiles }
export { push, pull, stageFiles, unstageFiles, discardChanges, commit }
export { getRemoteUrl, getRemotes, getGitUserConfig, setGitUserConfig, clearGitUserConfig, isRepoRoot, findChildRepos }

class GitService {
  getWorktrees = getWorktrees
  addWorktree = addWorktree
  removeWorktree = removeWorktree
  cloneRepo = cloneRepo

  getBranches = getBranches
  getRemoteBranches = getRemoteBranches
  setUpstream = setUpstream
  renameBranch = renameBranch
  getTrackingBranch = getTrackingBranch
  isBranchProtected = isBranchProtected

  getStatus = getStatus
  getDiff = getDiff
  getFileDiff = getFileDiff
  getStagedDiff = getStagedDiff
  getStagedFiles = getStagedFiles
  getFileTree = getFileTree
  getTrackedFiles = getTrackedFiles
  readFile = readFile
  writeFile = writeFile
  readFileAsBase64 = readFileAsBase64
  getFileSize = getFileSize
  invalidateFileTree = invalidateFileTree
  invalidateTrackedFiles = invalidateTrackedFiles

  push = push
  pull = pull
  stageFiles = stageFiles
  unstageFiles = unstageFiles
  discardChanges = discardChanges
  commit = commit

  getRemoteUrl = getRemoteUrl
  getRemotes = getRemotes
  getGitUserConfig = getGitUserConfig
  setGitUserConfig = setGitUserConfig
  clearGitUserConfig = clearGitUserConfig
  isRepoRoot = isRepoRoot
  findChildRepos = findChildRepos
}

export const gitService = new GitService()
