import type { PrStatus } from '@/store/prCache'
import type { PendingTaskPrRequest } from '@/store/ui'
import type { Project } from '@/types'

export function buildTaskPrRequest(
  projects: Project[],
  worktreePath: string,
  pr: PrStatus
): Omit<PendingTaskPrRequest, 'id'> | null {
  for (const project of projects) {
    const worktree = project.worktrees.find((item) => item.path === worktreePath)
    if (!worktree) continue

    return {
      detailBackTarget: 'worktree',
      projectId: project.id,
      projectName: project.name,
      repoPath: project.path,
      worktreeId: worktree.id,
      matchingBranch: worktree.branch,
      pr: {
        number: pr.number,
        title: pr.title,
        state: pr.state,
        url: pr.url,
        headBranch: pr.headBranch,
        baseBranch: pr.baseRefName,
        isDraft: pr.isDraft,
        mergeable: pr.mergeable,
        reviewDecision: pr.reviewDecision,
        mergeStateStatus: pr.mergeStateStatus,
      },
    }
  }

  return null
}
