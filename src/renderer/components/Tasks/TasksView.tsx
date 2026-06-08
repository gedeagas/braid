import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useProjectsStore } from '@/store/projects'
import { useUIStore, type PendingTaskPrRequest } from '@/store/ui'
import { IconClose } from '@/components/shared/icons'
import { AddWorktreeDialog, type AddWorktreeDialogPrefill } from '@/components/Sidebar/AddWorktreeDialog'
import type { Worktree } from '@/types'
import type { TaskRow, WorkItemState } from './types'
import { useTaskListController } from './useTaskListController'
import { usePrDetailController } from './usePrDetailController'
import { TaskListView } from './TaskListView'
import { PrDetailView } from './PrDetailView'

interface CreateWorktreeDialogRequest {
  row: TaskRow
  prefill: AddWorktreeDialogPrefill
}

function extractFirstJiraKey(title: string): string | null {
  const match = title.match(/\b[A-Z]{2,10}-\d+\b/i)
  return match ? match[0].toUpperCase() : null
}

function normalizeWorkItemState(state: string): WorkItemState {
  const normalized = state.toLowerCase()
  if (normalized === 'merged') return 'merged'
  if (normalized === 'closed') return 'closed'
  return 'open'
}

function buildPendingPrRow(request: PendingTaskPrRequest): TaskRow {
  return {
    detailBackTarget: request.detailBackTarget,
    projectId: request.projectId,
    projectName: request.projectName,
    repoPath: request.repoPath,
    matchingWorktreeId: request.worktreeId,
    matchingBranch: request.matchingBranch,
    item: {
      id: `pr:${request.repoPath}:${request.pr.number}`,
      type: 'pr',
      number: request.pr.number,
      title: request.pr.title,
      state: normalizeWorkItemState(request.pr.state),
      url: request.pr.url,
      author: '',
      labels: [],
      assignees: [],
      updatedAt: '',
      isDraft: request.pr.isDraft,
      headBranch: request.pr.headBranch ?? undefined,
      baseBranch: request.pr.baseBranch ?? undefined,
      mergeable: request.pr.mergeable,
      reviewDecision: request.pr.reviewDecision,
      mergeStateStatus: request.pr.mergeStateStatus,
    },
  }
}

export function TasksView() {
  const { t: tSidebar } = useTranslation('sidebar')
  const projects = useProjectsStore((s) => s.projects)
  const tasksActive = useUIStore((s) => s.tasksActive)
  const toggleTasks = useUIStore((s) => s.toggleTasks)
  const selectWorktree = useUIStore((s) => s.selectWorktree)
  const pendingTaskPrRequest = useUIStore((s) => s.pendingTaskPrRequest)
  const clearPendingTaskPrRequest = useUIStore((s) => s.clearPendingTaskPrRequest)
  const [selectedRow, setSelectedRow] = useState<TaskRow | null>(null)
  const [createWorktreeRequest, setCreateWorktreeRequest] = useState<CreateWorktreeDialogRequest | null>(null)

  const openCreateWorktreeDialog = (row: TaskRow) => {
    if (row.item.type !== 'pr' || !row.item.headBranch) return
    setCreateWorktreeRequest({
      row,
      prefill: {
        branch: row.item.headBranch,
        sourceBranch: row.item.headBranch,
        baseBranch: row.item.baseBranch,
        jiraKey: extractFirstJiraKey(row.item.title),
        locked: true,
      },
    })
  }

  const list = useTaskListController({
    projects,
    tasksActive,
    toggleTasks,
    selectWorktree,
    setSelectedRow,
  })
  const detail = usePrDetailController({
    selectedRow,
    setSelectedRow,
    fetchTasks: list.fetchTasks,
    openCreateWorktreeDialog,
    selectWorktree,
    toggleTasks,
  })

  useEffect(() => {
    if (!pendingTaskPrRequest) return
    setSelectedRow(buildPendingPrRow(pendingTaskPrRequest))
    clearPendingTaskPrRequest(pendingTaskPrRequest.id)
  }, [clearPendingTaskPrRequest, pendingTaskPrRequest])

  const handleWorktreeCreated = (request: CreateWorktreeDialogRequest, worktree: Worktree) => {
    list.fetchTasks(true)
    setSelectedRow((current) => current && current.projectId === request.row.projectId && current.item.id === request.row.item.id
      ? { ...current, matchingWorktreeId: worktree.id, matchingBranch: worktree.branch }
      : current)
  }

  return (
    <div className="pull-requests-page">
      <div className="pull-requests-header">
        <div className="drag-region" />
        <span className="pull-requests-title">{tSidebar('tasks')}</span>
        <button className="btn-icon" onClick={toggleTasks} aria-label={tSidebar('closeTasks')}>
          <IconClose size={11} />
        </button>
      </div>

      {selectedRow && detail.detailItem ? (
        <PrDetailView selectedRow={selectedRow} setSelectedRow={setSelectedRow} detail={detail} />
      ) : (
        <TaskListView
          {...list}
          creatingWorktreeForRowId={detail.review.creatingWorktreeForRowId}
          handleCreateWorktreeForRow={detail.actions.handleCreateWorktreeForRow}
        />
      )}
      {createWorktreeRequest && (
        <AddWorktreeDialog
          projectId={createWorktreeRequest.row.projectId}
          repoPath={createWorktreeRequest.row.repoPath}
          prefill={createWorktreeRequest.prefill}
          onClose={() => setCreateWorktreeRequest(null)}
          onCreated={(worktree) => handleWorktreeCreated(createWorktreeRequest, worktree)}
        />
      )}
    </div>
  )
}
