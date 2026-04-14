import { useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/store/ui'
import { useDragScroll } from '@/hooks/useDragScroll'
import { IconArrowLeft, IconClose } from '@/components/shared/icons'
import { SettingsNav } from './SettingsNav'
import { SettingsGeneral } from './SettingsGeneral'
import { SettingsAppearance } from './SettingsAppearance'
import { SettingsAI } from './SettingsAI'
import { SettingsGit } from './SettingsGit'
import { SettingsNotifications } from './SettingsNotifications'
import { SettingsEditor } from './SettingsEditor'
import { SettingsProject } from './SettingsProject'
import { SettingsClaudePermissions } from './SettingsClaudePermissions'
import { SettingsClaudeHooks } from './SettingsClaudeHooks'
import { SettingsClaudeInstructions } from './SettingsClaudeInstructions'
import { SettingsClaudePlugins } from './SettingsClaudePlugins'
import { SettingsClaudeMcp } from './SettingsClaudeMcp'
import { SettingsClaudeSkills } from './SettingsClaudeSkills'
import { SettingsApps } from './SettingsApps'
import { SettingsAnalytics } from './SettingsAnalytics'
import { SettingsAbout } from './SettingsAbout'

/**
 * Maps nav section keys → their rendered page component.
 *
 * To add a new settings page:
 *   1. Create Settings/SettingsMyPage.tsx (root element: <div className="settings-section">)
 *   2. Import it here and add an entry below
 *   3. Add translations to locales/en/settings.json + locales/ja/settings.json
 *   4. Add to NAV_GROUPS in SettingsNav.tsx so it appears in the sidebar
 *
 * Per-project pages are handled separately via the "project:{id}" prefix below.
 */
const sectionMap: Record<string, React.ReactNode> = {
  general: <SettingsGeneral />,
  appearance: <SettingsAppearance />,
  ai: <SettingsAI />,
  git: <SettingsGit />,
  notifications: <SettingsNotifications />,
  editor: <SettingsEditor />,
  claudePermissions: <SettingsClaudePermissions />,
  claudeHooks: <SettingsClaudeHooks />,
  claudeInstructions: <SettingsClaudeInstructions />,
  claudePlugins: <SettingsClaudePlugins />,
  claudeMcp: <SettingsClaudeMcp />,
  claudeSkills: <SettingsClaudeSkills />,
  apps: <SettingsApps />,
  analytics: <SettingsAnalytics />,
  about: <SettingsAbout />,
}

function SettingsContent() {
  const { t } = useTranslation('settings')
  const settingsSection = useUIStore((s) => s.settingsSection)
  const closeSettings = useUIStore((s) => s.closeSettings)

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') closeSettings()
  }, [closeSettings])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // ── Drag-to-scroll for the settings content area ───────────────────
  const contentRef = useRef<HTMLDivElement>(null)
  const { onMouseDown: contentMouseDown, preventClickAfterDrag } = useDragScroll(contentRef, { axis: 'y' })
  const closeBtnRef = useRef<HTMLButtonElement>(null)

  // Move focus into the dialog when it first mounts
  useEffect(() => { closeBtnRef.current?.focus() }, [])

  // Route project:${id} sections to SettingsProject
  let content: React.ReactNode
  if (settingsSection.startsWith('project:')) {
    const projectId = settingsSection.slice('project:'.length)
    content = <SettingsProject projectId={projectId} />
  } else {
    content = sectionMap[settingsSection] ?? sectionMap.general
  }

  return (
    <div
      className="settings-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t('title')}
    >
      <div className="settings-header">
        <button className="settings-back btn-icon" onClick={closeSettings}>
          <IconArrowLeft size={12} /> {t('back')}
        </button>
        <span className="settings-title">{t('title')}</span>
        <button
          ref={closeBtnRef}
          className="settings-close btn-icon"
          onClick={closeSettings}
          aria-label={t('close', { ns: 'common' })}
        >
          <IconClose size={10} />
        </button>
      </div>
      <div className="settings-body">
        <SettingsNav />
        <div className="settings-section-content" ref={contentRef} onMouseDown={contentMouseDown} onClickCapture={preventClickAfterDrag()}>
          {content}
        </div>
      </div>
    </div>
  )
}

export function SettingsOverlay() {
  const settingsOpen = useUIStore((s) => s.settingsOpen)
  if (!settingsOpen) return null
  return createPortal(<SettingsContent />, document.body)
}
