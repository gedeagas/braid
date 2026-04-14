import { memo, useState } from 'react'
import { ProjectList } from './ProjectList'
import { AddProjectDialog } from './AddProjectDialog'
import { AddWorktreeDialog } from './AddWorktreeDialog'
import { useUIStore } from '@/store/ui'
import { Tooltip } from '@/components/shared/Tooltip'
import { useProjectsStore } from '@/store/projects'
import { useTranslation } from 'react-i18next'
import { OverviewBanner } from '@/components/MissionControl/OverviewBanner'

export const SidebarView = memo(function SidebarView() {
  const showAddProject = useUIStore((s) => s.showAddProject)
  const setShowAddProject = useUIStore((s) => s.setShowAddProject)
  const projects = useProjectsStore((s) => s.projects)
  const { t } = useTranslation('sidebar')

  const [addWorktreeProjectId, setAddWorktreeProjectId] = useState<string | null>(null)
  const addWorktreeProject = addWorktreeProjectId
    ? projects.find((p) => p.id === addWorktreeProjectId) ?? null
    : null

  return (
    <>
      <div className="sidebar-panel-spacer" />
      <OverviewBanner />
      <div className="sidebar-header">
        <span className="sidebar-title">{t('projects')}</span>
        <div className="sidebar-header-actions">
          <Tooltip content={t('addProject')} position="bottom">
            <button
              className="btn-icon"
              onClick={() => setShowAddProject(true)}
            >
              +
            </button>
          </Tooltip>
        </div>
      </div>
      <div
        className="sidebar-content"
        data-tour="sidebar"
      >
        <ProjectList onAddWorktree={(id) => setAddWorktreeProjectId(id)} />
      </div>

      {showAddProject && <AddProjectDialog />}
      {addWorktreeProject && (
        <AddWorktreeDialog
          projectId={addWorktreeProject.id}
          repoPath={addWorktreeProject.path}
          onClose={() => setAddWorktreeProjectId(null)}
        />
      )}
    </>
  )
})
