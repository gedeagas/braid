import { memo, useCallback } from 'react'
import { useUIStore } from '@/store/ui'
import { useProjectsStore } from '@/store/projects'
import { TabbedTerminal } from '@/components/Right/TabbedTerminal'
import { ResizeHandle } from '@/components/shared/ResizeHandle'

const DEFAULT_HEIGHT = 250

/**
 * Terminal strip rendered at the bottom of CenterPanel when the
 * "Bottom terminal strip" experiment is enabled. Shows only pty shell tabs
 * (Setup and Run remain in the right panel via SetupRunPanel).
 *
 * Uses its own height/collapsed state (centerTerminalHeight/centerTerminalCollapsed)
 * so resizing it never affects the right panel's terminal section.
 */
export const BottomTerminalStrip = memo(function BottomTerminalStrip() {
  const selectedProjectId = useUIStore((s) => s.selectedProjectId)
  const selectedWorktreeId = useUIStore((s) => s.selectedWorktreeId)
  const collapsed = useUIStore((s) => s.centerTerminalCollapsed)
  const setCollapsed = useUIStore((s) => s.setCenterTerminalCollapsed)
  const height = useUIStore((s) => s.centerTerminalHeight)
  const setHeight = useUIStore((s) => s.setCenterTerminalHeight)
  const persistHeight = useUIStore((s) => s.persistCenterTerminalHeight)

  const project = useProjectsStore((s) => s.projects.find((p) => p.id === selectedProjectId))
  const worktree = project?.worktrees.find((w) => w.id === selectedWorktreeId)

  const handleResize = useCallback((delta: number) => {
    const current = useUIStore.getState().centerTerminalHeight || DEFAULT_HEIGHT
    setHeight(current - delta)
  }, [setHeight])

  if (!worktree || !selectedProjectId) return null

  return (
    <div
      className="bottom-terminal-strip"
      style={{
        height: collapsed ? 36 : (height || DEFAULT_HEIGHT),
        minHeight: collapsed ? 36 : 120,
        // Only show border when collapsed — the ResizeHandle provides visual
        // separation when expanded, so we avoid a double-border.
        borderTop: collapsed ? '1px solid var(--border)' : 'none',
      }}
    >
      {!collapsed && (
        <ResizeHandle
          direction="vertical"
          onResize={handleResize}
          onResizeEnd={persistHeight}
        />
      )}
      <TabbedTerminal
        worktreePath={worktree.path}
        projectId={selectedProjectId!}
        projectPath={project?.path ?? worktree.path}
        hidden={collapsed}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed(!useUIStore.getState().centerTerminalCollapsed)}
        showFixedTabs={false}
      />
    </div>
  )
})
