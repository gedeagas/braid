import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/store/ui'
import { useProjectsStore } from '@/store/projects'

/**
 * Sidebar navigation groups for the settings overlay.
 *
 * Each entry renders as a labelled group with clickable items.
 * - `header` maps to a t(`groups.<header>`) translation key
 * - `items` are section keys that map to t(`sections.<item>`) labels
 *   AND must have a matching entry in the sectionMap in SettingsOverlay.tsx
 *
 * To add a page to an existing group, append its key to the relevant `items` array.
 * To create a new group, add a new entry with a unique `header` and add the group
 * label to locales/en/settings.json under `groups.<header>`.
 *
 * The "Projects" group at the bottom is generated dynamically from the projects store
 * and uses section keys of the form "project:{id}" — handled in SettingsOverlay.tsx.
 */
const NAV_GROUPS = [
  { header: 'general', items: ['general', 'editor', 'analytics', 'about'] },
  { header: 'claudeAgent', items: ['ai', 'claudePermissions', 'claudeHooks', 'claudeInstructions', 'claudePlugins', 'claudeMcp', 'claudeSkills'] },
  { header: 'appearance', items: ['appearance'] },
  { header: 'integrations', items: ['apps', 'git', 'jira', 'notifications'] },
]

export function SettingsNav() {
  const { t } = useTranslation('settings')
  const settingsSection = useUIStore((s) => s.settingsSection)
  const setSettingsSection = useUIStore((s) => s.setSettingsSection)
  const projects = useProjectsStore((s) => s.projects)

  const navGroups = NAV_GROUPS

  return (
    <nav className="settings-nav">
      {navGroups.map((group) => (
        <div key={group.header} className="settings-nav-group">
          <span className="settings-nav-group-header">
            {t(`groups.${group.header}`)}
          </span>
          {group.items.map((item) => (
            <button
              key={item}
              className={`settings-nav-item${settingsSection === item ? ' settings-nav-item--active' : ''}`}
              onClick={() => setSettingsSection(item)}
            >
              {t(`sections.${item}`)}
            </button>
          ))}
        </div>
      ))}

      {/* Dynamic project list */}
      {projects.length > 0 && (
        <div className="settings-nav-group">
          <span className="settings-nav-group-header">
            {t('groups.projects')}
          </span>
          {projects.map((p) => (
            <button
              key={p.id}
              className={`settings-nav-item${settingsSection === `project:${p.id}` ? ' settings-nav-item--active' : ''}`}
              onClick={() => setSettingsSection(`project:${p.id}`)}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}
    </nav>
  )
}
