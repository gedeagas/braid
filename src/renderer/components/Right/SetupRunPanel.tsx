import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/store/ui'
import { FixedTabButton } from './TabbedTerminal'
import { SetupPanel } from './SetupPanel'
import { RunPanel } from './RunPanel'

type ActiveTab = 'setup' | 'run'

interface Props {
  worktreePath: string
  projectId: string
  projectPath: string
  collapsed?: boolean
  onToggleCollapse?: () => void
}

/**
 * Lightweight Setup + Run panel for the right panel when the bottom terminal
 * strip experiment is enabled. Unlike TabbedTerminal, this component has no
 * involvement with terminalCache — it manages only the two fixed tabs via
 * plain React state, so it never conflicts with the pty terminal tabs owned
 * by BottomTerminalStrip.
 */
export function SetupRunPanel({ worktreePath, projectId, projectPath, collapsed, onToggleCollapse }: Props) {
  const { t } = useTranslation('right')
  const [activeTab, setActiveTab] = useState<ActiveTab>('setup')

  const activate = useCallback((tab: ActiveTab) => {
    setActiveTab(tab)
    if (collapsed && onToggleCollapse) onToggleCollapse()
  }, [collapsed, onToggleCollapse])

  // Auto-switch to Setup when a setup run is triggered for this worktree
  useEffect(() => {
    return useUIStore.subscribe((state, prev) => {
      if (state.pendingSetupRun && !prev.pendingSetupRun) {
        if (state.pendingSetupRun.worktreePath === worktreePath) {
          setActiveTab('setup')
          if (collapsed && onToggleCollapse) onToggleCollapse()
        }
      }
    })
  }, [worktreePath, collapsed, onToggleCollapse])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', minHeight: 0 }}>
      {/* Tab bar */}
      <div
        className="scrollbar-overlay"
        style={{
          display: 'flex', alignItems: 'stretch',
          background: 'var(--bg-secondary)', flexShrink: 0,
          borderBottom: collapsed ? 'none' : '1px solid var(--border)',
          overflowX: 'auto', overflowY: 'hidden',
        }}
      >
        <span
          style={{
            fontSize: 12, padding: '0 6px 0 10px',
            color: 'var(--text-muted)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', flexShrink: 0,
          }}
          onClick={onToggleCollapse}
        >
          {collapsed ? '▶' : '▼'}
        </span>
        <FixedTabButton
          active={activeTab === 'setup'}
          icon="⚙"
          label={t('setupLabel')}
          onClick={() => activate('setup')}
        />
        <FixedTabButton
          active={activeTab === 'run'}
          icon="▶"
          label={t('runLabel')}
          onClick={() => activate('run')}
        />
      </div>

      {/* Content */}
      {!collapsed && (
        <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
          <div style={{ position: 'absolute', inset: 0, display: activeTab === 'setup' ? 'flex' : 'none' }}>
            <SetupPanel worktreePath={worktreePath} projectId={projectId} hidden={activeTab !== 'setup'} />
          </div>
          <div style={{ position: 'absolute', inset: 0, display: activeTab === 'run' ? 'flex' : 'none' }}>
            <RunPanel
              worktreePath={worktreePath}
              projectPath={projectPath}
              projectId={projectId}
              hidden={activeTab !== 'run'}
            />
          </div>
        </div>
      )}
    </div>
  )
}
