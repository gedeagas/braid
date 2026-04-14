import { useEffect, useReducer, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/store/ui'
import { useProjectsStore } from '@/store/projects'
import { shell, claudeCli, jira } from '@/lib/ipc'
import { Spinner } from '@/components/ui/Spinner'
import { Button } from '@/components/ui/Button'
import {
  IconCheckmark,
  IconXCircle,
  IconRefresh,
  IconExternalLink,
  IconSparkle,
} from '@/components/shared/icons'
import { GhAuthDialog } from '@/components/shared/GhAuthDialog'

// ── Types ────────────────────────────────────────────────────────────────────

type Step = 'welcome' | 'doctor' | 'project'
type CheckKey = 'git' | 'claude' | 'gh' | 'ghAuth' | 'acli'
type CheckStatus = 'pending' | 'checking' | 'ok' | 'fail' | 'installing'

interface State {
  step: Step
  checks: Record<CheckKey, CheckStatus>
  /** Tracks which keys have had at least one install attempt. After a failed
   *  attempt the row surfaces the docs link so the user has a fallback path. */
  installAttempted: Partial<Record<CheckKey, boolean>>
  showGhAuthDialog: boolean
}

type Action =
  | { type: 'set_step'; step: Step }
  | { type: 'start_checks' }
  | { type: 'set_check'; key: CheckKey; status: CheckStatus }
  | { type: 'mark_install_attempted'; key: CheckKey }
  | { type: 'show_gh_auth_dialog' }
  | { type: 'hide_gh_auth_dialog' }

const initialState: State = {
  step: 'welcome',
  checks: { git: 'pending', claude: 'pending', gh: 'pending', ghAuth: 'pending', acli: 'pending' },
  installAttempted: {},
  showGhAuthDialog: false,
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'set_step':
      return { ...state, step: action.step }
    case 'start_checks':
      return {
        ...state,
        checks: { git: 'checking', claude: 'checking', gh: 'checking', ghAuth: 'checking', acli: 'checking' },
      }
    case 'set_check':
      return { ...state, checks: { ...state.checks, [action.key]: action.status } }
    case 'mark_install_attempted':
      return { ...state, installAttempted: { ...state.installAttempted, [action.key]: true } }
    case 'show_gh_auth_dialog':
      return { ...state, showGhAuthDialog: true }
    case 'hide_gh_auth_dialog':
      return { ...state, showGhAuthDialog: false }
    default:
      return state
  }
}

// ── Check metadata ────────────────────────────────────────────────────────────

interface AutoInstall {
  /** i18n key for the button label — defaults to `onboarding.doctor.install` */
  buttonLabelKey?: string
  /** i18n key for inline progress text shown while the install command runs */
  progressKey: string
}

interface CheckMeta {
  label: string
  required: boolean
  installHint?: string
  installUrl?: string
  /** When set, shows an actionable button that runs the install command */
  autoInstall?: AutoInstall
}

const CHECK_META: Record<CheckKey, CheckMeta> = {
  git: {
    label: 'Git',
    required: true,
    autoInstall: { progressKey: 'onboarding.doctor.progressGit' },
  },
  claude: {
    label: 'Claude Code',
    required: true,
    installUrl: 'https://claude.ai/download',
    autoInstall: { progressKey: 'onboarding.doctor.progressClaude' },
  },
  gh: {
    label: 'GitHub CLI',
    required: true,
    installUrl: 'https://cli.github.com/',
    autoInstall: { progressKey: 'onboarding.doctor.progressGh' },
  },
  ghAuth: {
    label: 'GitHub CLI (authenticated)',
    required: true,
    autoInstall: {
      buttonLabelKey: 'onboarding.doctor.logIn',
      progressKey: 'onboarding.doctor.progressGhAuth',
    },
  },
  acli: {
    label: 'Atlassian CLI',
    required: false,
    installUrl: 'https://www.npmjs.com/package/@atlassian/acli',
    autoInstall: { progressKey: 'onboarding.doctor.progressAcli' },
  },
}

// ── Check functions (module-level so useCallback deps stay stable) ────────────

const CHECK_FNS: Record<CheckKey, () => Promise<boolean>> = {
  git: () => shell.checkTool('git'),
  claude: async () => {
    try {
      const detected = await claudeCli.detectPath()
      if (detected !== null) return true
    } catch {
      // dynamic require broken in some build configs — fall through
    }
    return shell.checkTool('claude')
  },
  gh: () => shell.checkTool('gh'),
  ghAuth: () => shell.checkGhAuth(),
  acli: () => jira.isAvailable(),
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StepDots({ step }: { step: Step }) {
  const steps: Step[] = ['welcome', 'doctor', 'project']
  return (
    <div className="onboarding-step-dots">
      {steps.map((s) => (
        <div key={s} className={`onboarding-step-dot${step === s ? ' onboarding-step-dot--active' : ''}`} />
      ))}
    </div>
  )
}

function CheckStatusIcon({ status }: { status: CheckStatus }) {
  if (status === 'checking' || status === 'installing') return <Spinner size="sm" />
  if (status === 'ok') return <IconCheckmark size={14} className="onboarding-check-ok" />
  if (status === 'fail') return <IconXCircle size={14} className="onboarding-check-fail" />
  return <div className="onboarding-check-pending" />
}

function CheckRow({
  checkKey,
  status,
  installAttempted,
  onInstall,
}: {
  checkKey: CheckKey
  status: CheckStatus
  installAttempted: boolean
  onInstall: (key: CheckKey) => void
}) {
  const meta = CHECK_META[checkKey]
  const { t } = useTranslation('common')
  const busy = status === 'installing' || status === 'checking'

  return (
    <div className={`onboarding-check-row${status === 'ok' ? ' onboarding-check-row--ok' : ''}`}>
      <div className="onboarding-check-info">
        <span className="onboarding-check-label">
          {meta.label}
          {!meta.required && (
            <span className="onboarding-check-optional">{t('onboarding.doctor.optional')}</span>
          )}
        </span>

        {status === 'fail' && (
          <div className="onboarding-check-actions">
            {meta.autoInstall && (
              <button className="onboarding-install-btn" disabled={busy} onClick={() => onInstall(checkKey)}>
                {meta.autoInstall.buttonLabelKey ? t(meta.autoInstall.buttonLabelKey) : t('onboarding.doctor.install')}
              </button>
            )}
            {/* After a failed install attempt, always surface the docs link as a fallback */}
            {(installAttempted || !meta.autoInstall) && meta.installUrl ? (
              <button className="onboarding-check-link" onClick={() => shell.openExternal(meta.installUrl!)}>
                {t('onboarding.doctor.openDocs')} <IconExternalLink size={10} />
              </button>
            ) : !meta.autoInstall && meta.installHint ? (
              <code className="onboarding-check-code">{meta.installHint}</code>
            ) : null}
          </div>
        )}

        {busy && (
          <span className="onboarding-check-progress">
            {meta.autoInstall ? t(meta.autoInstall.progressKey) : t('onboarding.doctor.installing')}
          </span>
        )}
      </div>

      <div className="onboarding-check-status">
        <CheckStatusIcon status={status} />
      </div>
    </div>
  )
}

// ── Steps ─────────────────────────────────────────────────────────────────────

function WelcomeStep({ onNext }: { onNext: () => void }) {
  const { t } = useTranslation('common')
  return (
    <div className="onboarding-step">
      <div className="onboarding-welcome-icon">
        <IconSparkle size={40} />
      </div>
      <h1 className="onboarding-title">{t('onboarding.welcome.title')}</h1>
      <p className="onboarding-subtitle">{t('onboarding.welcome.subtitle')}</p>
      <p className="onboarding-description">{t('onboarding.welcome.description')}</p>
      <Button variant="primary" onClick={onNext}>
        {t('onboarding.welcome.getStarted')}
      </Button>
    </div>
  )
}

function DoctorStep({
  checks,
  installAttempted,
  onRunChecks,
  onInstall,
  onNext,
}: {
  checks: Record<CheckKey, CheckStatus>
  installAttempted: Partial<Record<CheckKey, boolean>>
  onRunChecks: () => void
  onInstall: (key: CheckKey) => void
  onNext: () => void
}) {
  const { t } = useTranslation('common')
  const allDone = Object.values(checks).every((s) => s === 'ok' || s === 'fail')
  // Don't block continue while ghAuth is installing — the OAuth browser flow can
  // take a while and the user should be able to skip it.
  const anyBusy = Object.entries(checks).some(
    ([k, s]) => (s === 'checking' || s === 'pending' || s === 'installing') && k !== 'ghAuth'
  )
  const hasRequiredFailures = Object.entries(checks).some(
    ([k, s]) => s === 'fail' && CHECK_META[k as CheckKey].required
  )

  useEffect(() => { onRunChecks() }, [onRunChecks])

  return (
    <div className="onboarding-step">
      <h1 className="onboarding-title">{t('onboarding.doctor.title')}</h1>
      <p className="onboarding-subtitle">{t('onboarding.doctor.subtitle')}</p>
      <div className="onboarding-checks">
        {(Object.keys(checks) as CheckKey[]).map((key) => (
          <CheckRow
            key={key}
            checkKey={key}
            status={checks[key]}
            installAttempted={!!installAttempted[key]}
            onInstall={onInstall}
          />
        ))}
      </div>
      <div className="onboarding-actions">
        {allDone && hasRequiredFailures && (
          <Button size="sm" onClick={onRunChecks} className="onboarding-retry-btn">
            <IconRefresh size={12} /> {t('onboarding.doctor.retry')}
          </Button>
        )}
        <Button variant="primary" onClick={onNext} disabled={anyBusy}>
          {hasRequiredFailures
            ? t('onboarding.doctor.continueAnyway')
            : t('onboarding.doctor.continue')}
        </Button>
      </div>
    </div>
  )
}

function ProjectStep({ onSkip }: { onSkip: () => void }) {
  const { t } = useTranslation('common')
  const setShowAddProject = useUIStore((s) => s.setShowAddProject)
  const projects = useProjectsStore((s) => s.projects)
  const setOnboardingComplete = useUIStore((s) => s.setOnboardingComplete)

  useEffect(() => {
    if (projects.length > 0) setOnboardingComplete(true)
  }, [projects.length, setOnboardingComplete])

  return (
    <div className="onboarding-step">
      <h1 className="onboarding-title">{t('onboarding.project.title')}</h1>
      <p className="onboarding-subtitle">{t('onboarding.project.subtitle')}</p>
      <div className="onboarding-project-actions">
        <Button variant="primary" onClick={() => setShowAddProject(true)}>
          {t('onboarding.project.openProject')}
        </Button>
        <button className="onboarding-skip-link" onClick={onSkip}>
          {t('onboarding.project.skip')}
        </button>
      </div>
    </div>
  )
}

// ── Main overlay ──────────────────────────────────────────────────────────────

function OnboardingContent() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const setOnboardingComplete = useUIStore((s) => s.setOnboardingComplete)
  const cardRef = useRef<HTMLDivElement>(null)

  // Focus the card on mount so keyboard navigation works immediately
  useEffect(() => {
    const frame = requestAnimationFrame(() => cardRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [])

  // Escape on the project step acts like "Skip for now"
  useEffect(() => {
    if (state.step !== 'project') return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOnboardingComplete(true) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [state.step, setOnboardingComplete])

  const runChecks = useCallback(async () => {
    dispatch({ type: 'start_checks' })

    // Run independent checks in parallel, but hold ghAuth until gh resolves —
    // there's no point checking gh auth if the CLI itself isn't installed.
    const independent = (Object.keys(CHECK_FNS) as CheckKey[]).filter((k) => k !== 'ghAuth')
    const results = new Map<CheckKey, boolean>()

    await Promise.all(
      independent.map(async (key) => {
        try {
          const ok = await CHECK_FNS[key]()
          results.set(key, ok)
          dispatch({ type: 'set_check', key, status: ok ? 'ok' : 'fail' })
        } catch {
          results.set(key, false)
          dispatch({ type: 'set_check', key, status: 'fail' })
        }
      })
    )

    // Only check ghAuth if gh itself passed
    if (results.get('gh')) {
      try {
        const ok = await CHECK_FNS.ghAuth()
        dispatch({ type: 'set_check', key: 'ghAuth', status: ok ? 'ok' : 'fail' })
      } catch {
        dispatch({ type: 'set_check', key: 'ghAuth', status: 'fail' })
      }
    } else {
      dispatch({ type: 'set_check', key: 'ghAuth', status: 'fail' })
    }
  }, [])

  // Runs the install command then immediately re-checks, regardless of install outcome.
  // ghAuth uses the Device Flow dialog instead of shell.installTool.
  const installAndRecheck = useCallback(async (key: CheckKey) => {
    if (key === 'ghAuth') {
      dispatch({ type: 'show_gh_auth_dialog' })
      return
    }
    dispatch({ type: 'mark_install_attempted', key })
    dispatch({ type: 'set_check', key, status: 'installing' })
    try { await shell.installTool(key) } catch { /* still recheck below */ }
    dispatch({ type: 'set_check', key, status: 'checking' })
    try {
      const ok = await CHECK_FNS[key]()
      dispatch({ type: 'set_check', key, status: ok ? 'ok' : 'fail' })
    } catch {
      dispatch({ type: 'set_check', key, status: 'fail' })
    }
  }, [])

  const handleGhAuthSuccess = useCallback(async () => {
    dispatch({ type: 'hide_gh_auth_dialog' })
    dispatch({ type: 'set_check', key: 'ghAuth', status: 'checking' })
    try {
      const ok = await CHECK_FNS.ghAuth()
      dispatch({ type: 'set_check', key: 'ghAuth', status: ok ? 'ok' : 'fail' })
    } catch {
      dispatch({ type: 'set_check', key: 'ghAuth', status: 'fail' })
    }
  }, [])

  const goToDoctor = useCallback(() => dispatch({ type: 'set_step', step: 'doctor' }), [])
  const goToProject = useCallback(() => dispatch({ type: 'set_step', step: 'project' }), [])
  const handleSkip = useCallback(() => setOnboardingComplete(true), [setOnboardingComplete])

  return (
    <div className="onboarding-overlay" role="dialog" aria-modal="true">
      <div className="onboarding-card" ref={cardRef} tabIndex={-1}>
        <StepDots step={state.step} />
        {state.step === 'welcome' && <WelcomeStep onNext={goToDoctor} />}
        {state.step === 'doctor' && (
          <DoctorStep
            checks={state.checks}
            installAttempted={state.installAttempted}
            onRunChecks={runChecks}
            onInstall={installAndRecheck}
            onNext={goToProject}
          />
        )}
        {state.step === 'project' && <ProjectStep onSkip={handleSkip} />}
      </div>
      <GhAuthDialog
        isOpen={state.showGhAuthDialog}
        onClose={() => dispatch({ type: 'hide_gh_auth_dialog' })}
        onSuccess={handleGhAuthSuccess}
      />
    </div>
  )
}

export function OnboardingOverlay() {
  const onboardingComplete = useUIStore((s) => s.onboardingComplete)
  const setOnboardingComplete = useUIStore((s) => s.setOnboardingComplete)
  const showAddProject = useUIStore((s) => s.showAddProject)
  const hasProjects = useProjectsStore((s) => s.projects.length > 0)

  // Auto-complete onboarding when a project exists. This covers the case where
  // the user adds a project via AddProjectDialog (which unmounts the overlay
  // while showAddProject is true). Without this, closing the dialog re-mounts
  // the overlay from step 1 because the ProjectStep effect never ran.
  useEffect(() => {
    if (!onboardingComplete && hasProjects) setOnboardingComplete(true)
  }, [onboardingComplete, hasProjects, setOnboardingComplete])

  if (onboardingComplete || showAddProject) return null
  return createPortal(<OnboardingContent />, document.body)
}
