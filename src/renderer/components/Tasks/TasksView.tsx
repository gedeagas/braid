import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useProjectsStore } from '@/store/projects'
import { useUIStore } from '@/store/ui'
import { IconClose } from '@/components/shared/icons'
import type { TaskRow } from './types'
import { useTaskListController } from './useTaskListController'
import { usePrDetailController } from './usePrDetailController'
import { TaskListView } from './TaskListView'
import { PrDetailView } from './PrDetailView'

export function TasksView() {
  const { t: tSidebar } = useTranslation('sidebar')
  const projects = useProjectsStore((s) => s.projects)
  const addWorktree = useProjectsStore((s) => s.addWorktree)
  const tasksActive = useUIStore((s) => s.tasksActive)
  const toggleTasks = useUIStore((s) => s.toggleTasks)
  const selectWorktree = useUIStore((s) => s.selectWorktree)
  const [selectedRow, setSelectedRow] = useState<TaskRow | null>(null)

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
    addWorktree,
    selectWorktree,
    toggleTasks,
  })

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
    </div>
  )
}
