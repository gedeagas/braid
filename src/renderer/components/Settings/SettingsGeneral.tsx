import { useReducer } from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/store/ui'
import { getAllPersistedBigTerminalIds } from '@/store/ui/terminals'
import { getAllPersistedRightTerminalIds } from '@/components/Right/terminalCache'
import * as ipc from '@/lib/ipc'
import { Toggle } from '@/components/shared/Toggle'
import { SegmentedControl } from '@/components/shared/SegmentedControl'
import { Button, FormField } from '@/components/ui'
import type { SupportedLanguage, ToolMessageStyle } from '@/store/ui'

const LANGUAGES: { value: SupportedLanguage; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'id', label: 'Bahasa Indonesia' },
  { value: 'zh', label: '简体中文' },
]

export function SettingsGeneral() {
  const { t } = useTranslation('settings')
  const { t: tCommon } = useTranslation('common')
  const language = useUIStore((s) => s.language)
  const setLanguage = useUIStore((s) => s.setLanguage)
  const toolMessageStyle = useUIStore((s) => s.toolMessageStyle)
  const setToolMessageStyle = useUIStore((s) => s.setToolMessageStyle)
  const skipDeleteWorktreeConfirm = useUIStore((s) => s.skipDeleteWorktreeConfirm)
  const setSkipDeleteWorktreeConfirm = useUIStore((s) => s.setSkipDeleteWorktreeConfirm)
  const keepAwakeWhileAgentsRun = useUIStore((s) => s.keepAwakeWhileAgentsRun)
  const setKeepAwakeWhileAgentsRun = useUIStore((s) => s.setKeepAwakeWhileAgentsRun)
  const setFeatureTourComplete = useUIStore((s) => s.setFeatureTourComplete)
  const closeSettings = useUIStore((s) => s.closeSettings)

  const toolStyleOptions: { value: ToolMessageStyle; label: string }[] = [
    { value: 'funny', label: t('general.toolStyleFunny') },
    { value: 'boring', label: t('general.toolStyleBoring') },
  ]

  return (
    <div className="settings-section">
      <FormField label={tCommon('language')}>
        <select
          className="settings-select"
          value={language}
          onChange={(e) => setLanguage(e.target.value as SupportedLanguage)}
        >
          {LANGUAGES.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </FormField>

      <FormField label={t('general.toolStyle')}>
        <SegmentedControl
          options={toolStyleOptions}
          value={toolMessageStyle}
          onChange={setToolMessageStyle}
        />
      </FormField>

      <FormField label={t('general.skipDeleteConfirm')} horizontal>
        <Toggle checked={skipDeleteWorktreeConfirm} onChange={setSkipDeleteWorktreeConfirm} />
      </FormField>

      <FormField label={t('general.keepAwake')} hint={t('general.keepAwakeHint')} horizontal>
        <Toggle checked={keepAwakeWhileAgentsRun} onChange={setKeepAwakeWhileAgentsRun} />
      </FormField>

      <FormField label={t('general.replayTour')} hint={t('general.replayTourHint')} horizontal>
        <Button
          size="sm"
          onClick={() => {
            setFeatureTourComplete(false)
            closeSettings()
          }}
        >
          {t('general.replayTour')}
        </Button>
      </FormField>

      <div className="settings-divider" />
      <FormField label={t('general.maintenance')} hint={t('general.maintenanceHint')}>
        <OrphanedTerminalsCard />
      </FormField>
    </div>
  )
}

interface Orphan {
  terminalId: string
  cwd: string
  label?: string
  agentId?: string
}

type OrphanState =
  | { status: 'idle' }
  | { status: 'scanning' }
  | { status: 'reviewing'; orphans: Orphan[] }
  | { status: 'killing'; orphans: Orphan[] }
  | { status: 'done'; killed: number }
  | { status: 'error' }

type OrphanAction =
  | { type: 'scan' }
  | { type: 'scanned'; orphans: Orphan[] }
  | { type: 'cancel' }
  | { type: 'kill' }
  | { type: 'killed'; count: number }
  | { type: 'error' }

function orphanReducer(state: OrphanState, action: OrphanAction): OrphanState {
  switch (action.type) {
    case 'scan':
      return { status: 'scanning' }
    case 'scanned':
      return { status: 'reviewing', orphans: action.orphans }
    case 'kill':
      return state.status === 'reviewing' ? { status: 'killing', orphans: state.orphans } : state
    case 'killed':
      return { status: 'done', killed: action.count }
    case 'cancel':
      return { status: 'idle' }
    case 'error':
      return { status: 'error' }
    default:
      return state
  }
}

/**
 * Manual cleanup for orphaned big-terminal daemon sessions. The renderer is
 * authoritative for "what should exist" (its persisted tab IDs across all
 * worktrees), so it scans them, asks main which live "bt-" sessions aren't in
 * that set, shows the list for review, and only reaps after the user confirms.
 */
function OrphanedTerminalsCard() {
  const { t } = useTranslation('settings')
  const { t: tCommon } = useTranslation('common')
  const [state, dispatch] = useReducer(orphanReducer, { status: 'idle' })

  const scan = async () => {
    dispatch({ type: 'scan' })
    try {
      const knownIds = [...getAllPersistedBigTerminalIds(), ...getAllPersistedRightTerminalIds()]
      const orphans = await ipc.pty.listOrphanedBigTerminals(knownIds)
      dispatch({ type: 'scanned', orphans })
    } catch {
      dispatch({ type: 'error' })
    }
  }

  const cleanUp = async (orphans: Orphan[]) => {
    dispatch({ type: 'kill' })
    try {
      const count = await ipc.pty.killOrphanedBigTerminals(orphans.map((orphan) => orphan.terminalId))
      dispatch({ type: 'killed', count })
    } catch {
      dispatch({ type: 'error' })
    }
  }

  if (state.status === 'idle' || state.status === 'scanning') {
    return (
      <Button size="sm" onClick={scan} disabled={state.status === 'scanning'}>
        {state.status === 'scanning' ? t('general.maintenanceScanning') : t('general.maintenanceScan')}
      </Button>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="settings-orphans">
        <p className="settings-orphans-error">{t('general.maintenanceError')}</p>
        <Button size="sm" onClick={scan}>{t('general.maintenanceRescan')}</Button>
      </div>
    )
  }

  if (state.status === 'done') {
    return (
      <div className="settings-orphans">
        <p className="settings-orphans-status">{t('general.maintenanceDone', { count: state.killed })}</p>
        <Button size="sm" onClick={scan}>{t('general.maintenanceRescan')}</Button>
      </div>
    )
  }

  // reviewing | killing
  const { orphans } = state
  if (orphans.length === 0) {
    return (
      <div className="settings-orphans">
        <p className="settings-orphans-status">{t('general.maintenanceNone')}</p>
        <Button size="sm" onClick={() => dispatch({ type: 'cancel' })}>{t('general.maintenanceClose')}</Button>
      </div>
    )
  }

  const killing = state.status === 'killing'
  return (
    <div className="settings-orphans">
      <p className="settings-orphans-status">{t('general.maintenanceFound', { count: orphans.length })}</p>
      <ul className="settings-orphans-list">
        {orphans.map((orphan) => (
          <li key={orphan.terminalId} className="settings-orphans-item">
            <span className="settings-orphans-item-label">{orphan.label || orphan.terminalId}</span>
            <span className="settings-orphans-item-cwd">{orphan.cwd}</span>
          </li>
        ))}
      </ul>
      <div className="settings-orphans-actions">
        <Button variant="danger" size="sm" onClick={() => cleanUp(orphans)} disabled={killing}>
          {killing ? t('general.maintenanceCleaning') : t('general.maintenanceCleanUp', { count: orphans.length })}
        </Button>
        <Button size="sm" onClick={() => dispatch({ type: 'cancel' })} disabled={killing}>
          {tCommon('cancel')}
        </Button>
      </div>
    </div>
  )
}
