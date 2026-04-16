import { memo, useState } from 'react'
import { ProjectList } from './ProjectList'
import { AddProjectDialog } from './AddProjectDialog'
import { AddWorktreeDialog } from './AddWorktreeDialog'
import { useUIStore } from '@/store/ui'
import { useProjectsStore } from '@/store/projects'
import { useTranslation } from 'react-i18next'
import { OverviewBanner } from '@/components/MissionControl/OverviewBanner'
import { ContextMenu } from '@/components/shared/ContextMenu'

export const SidebarView = memo(function SidebarView() {
  const showAddProject = useUIStore((s) => s.showAddProject)
  const setShowAddProject = useUIStore((s) => s.setShowAddProject)
  const projects = useProjectsStore((s) => s.projects)
  const { t } = useTranslation('sidebar')

  const [addWorktreeProjectId, setAddWorktreeProjectId] = useState<string | null>(null)
  const addWorktreeProject = addWorktreeProjectId
    ? projects.find((p) => p.id === addWorktreeProjectId) ?? null
    : null

  const [sidebarMenu, setSidebarMenu] = useState<{ x: number; y: number } | null>(null)

  return (
    <>
      <div className="sidebar-panel-spacer" />
      <OverviewBanner />
      <div className="sidebar-header">
        <span className="sidebar-title">{t('projects')}</span>
        <div className="sidebar-header-actions">
          <button
            className="sidebar-add-btn"
            onClick={() => setShowAddProject(true)}
          >
            + {t('addProject')}
          </button>
        </div>
      </div>
      <div
        className="sidebar-content"
        data-tour="sidebar"
        onContextMenu={(e) => {
          e.preventDefault()
          setSidebarMenu({ x: e.clientX, y: e.clientY })
        }}
      >
        <ProjectList onAddWorktree={(id) => setAddWorktreeProjectId(id)} />
      </div>

      {sidebarMenu && (
        <ContextMenu
          x={sidebarMenu.x}
          y={sidebarMenu.y}
          items={[{ label: t('addProject'), onClick: () => setShowAddProject(true) }]}
          onClose={() => setSidebarMenu(null)}
        />
      )}

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
