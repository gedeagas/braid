import { useEffect, useReducer, useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/store/ui'
import { useProjectsStore } from '@/store/projects'
import { shell, jira } from '@/lib/ipc'
import { Button } from '@/components/ui/Button'
import { GhAuthDialog } from '@/components/shared/GhAuthDialog'
import { OnboardingLayout } from './OnboardingLayout'
import {
  WelcomeStep,
  ModelStep,
  ThemeStep,
  NotificationStep,
  EnvironmentStep,
  ProjectStep,
  ExploreStep,
} from './steps'
import type { CheckKey, CheckStatus } from './steps'

// ── Constants ────────────────────────────────────────────────────────────────

const STEPS = ['welcome', 'model', 'theme', 'notifications', 'environment', 'project', 'explore'] as const
const TOTAL_STEPS = STEPS.length

// ── State ────────────────────────────────────────────────────────────────────

interface State {
  currentStep: number
  checks: Record<CheckKey, CheckStatus>
  installAttempted: Partial<Record<CheckKey, boolean>>
  showGhAuthDialog: boolean
}

type Action =
  | { type: 'go_to'; step: number }
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'start_checks' }
  | { type: 'set_check'; key: CheckKey; status: CheckStatus }
  | { type: 'mark_install_attempted'; key: CheckKey }
  | { type: 'show_gh_auth' }
  | { type: 'hide_gh_auth' }

const initialState: State = {
  currentStep: 0,
  checks: { git: 'pending', gh: 'pending', ghAuth: 'pending', acli: 'pending' },
  installAttempted: {},
  showGhAuthDialog: false,
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'go_to':
      return { ...state, currentStep: Math.max(0, Math.min(TOTAL_STEPS - 1, action.step)) }
    case 'next':
      return { ...state, currentStep: Math.min(TOTAL_STEPS - 1, state.currentStep + 1) }
    case 'back':
      return { ...state, currentStep: Math.max(0, state.currentStep - 1) }
    case 'start_checks':
      return {
        ...state,
        checks: { git: 'checking', gh: 'checking', ghAuth: 'checking', acli: 'checking' },
      }
    case 'set_check':
      return { ...state, checks: { ...state.checks, [action.key]: action.status } }
    case 'mark_install_attempted':
      return { ...state, installAttempted: { ...state.installAttempted, [action.key]: true } }
    case 'show_gh_auth':
      return { ...state, showGhAuthDialog: true }
    case 'hide_gh_auth':
      return { ...state, showGhAuthDialog: false }
    default:
      return state
  }
}

// ── Check functions ──────────────────────────────────────────────────────────

const CHECK_FNS: Record<CheckKey, () => Promise<boolean>> = {
  git: () => shell.checkTool('git'),
  gh: () => shell.checkTool('gh'),
  ghAuth: () => shell.checkGhAuth(),
  acli: () => jira.isAvailable(),
}

// ── Skip confirmation dialog ─────────────────────────────────────────────────

function SkipConfirmDialog({ onSkip, onCancel }: { onSkip: () => void; onCancel: () => void }) {
  const { t } = useTranslation('common')
  return (
    <div className="ob-skip-dialog-backdrop" onClick={onCancel}>
      <div
        className="ob-skip-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ob-skip-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="ob-skip-dialog-title" className="ob-skip-dialog-title">
          {t('onboarding.skipConfirm.title')}
        </h3>
        <p className="ob-skip-dialog-desc">{t('onboarding.skipConfirm.desc')}</p>
        <div className="ob-skip-dialog-actions">
          <Button onClick={onSkip}>{t('onboarding.skipConfirm.skip')}</Button>
          <Button variant="primary" onClick={onCancel}>{t('onboarding.skipConfirm.keepGoing')}</Button>
        </div>
      </div>
    </div>
  )
}

// ── Content ──────────────────────────────────────────────────────────────────

function OnboardingContent() {
  const { t } = useTranslation('common')
  const [state, dispatch] = useReducer(reducer, initialState)
  const [showSkipConfirm, setShowSkipConfirm] = useState(false)
  const setOnboardingComplete = useUIStore((s) => s.setOnboardingComplete)
  const setFeatureTourComplete = useUIStore((s) => s.setFeatureTourComplete)
  const hasProjects = useProjectsStore((s) => s.projects.length > 0)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const frame = requestAnimationFrame(() => containerRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [])

  // Escape key opens skip confirmation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowSkipConfirm(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Auto-advance past project step when a project is added
  useEffect(() => {
    if (hasProjects && STEPS[state.currentStep] === 'project') {
      dispatch({ type: 'next' })
    }
  }, [hasProjects, state.currentStep])

  const runChecks = useCallback(async () => {
    dispatch({ type: 'start_checks' })
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
      }),
    )
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

  const installAndRecheck = useCallback(async (key: CheckKey) => {
    if (key === 'ghAuth') {
      dispatch({ type: 'show_gh_auth' })
      return
    }
    dispatch({ type: 'mark_install_attempted', key })
    dispatch({ type: 'set_check', key, status: 'installing' })
    try { await shell.installTool(key) } catch { /* recheck below */ }
    dispatch({ type: 'set_check', key, status: 'checking' })
    try {
      const ok = await CHECK_FNS[key]()
      dispatch({ type: 'set_check', key, status: ok ? 'ok' : 'fail' })
    } catch {
      dispatch({ type: 'set_check', key, status: 'fail' })
    }
  }, [])

  const handleGhAuthSuccess = useCallback(async () => {
    dispatch({ type: 'hide_gh_auth' })
    dispatch({ type: 'set_check', key: 'ghAuth', status: 'checking' })
    try {
      const ok = await CHECK_FNS.ghAuth()
      dispatch({ type: 'set_check', key: 'ghAuth', status: ok ? 'ok' : 'fail' })
    } catch {
      dispatch({ type: 'set_check', key: 'ghAuth', status: 'fail' })
    }
  }, [])

  const goNext = useCallback(() => dispatch({ type: 'next' }), [])
  const goBack = useCallback(() => {
    const prev = state.currentStep - 1
    if (hasProjects && STEPS[prev] === 'project') {
      dispatch({ type: 'go_to', step: prev - 1 })
    } else {
      dispatch({ type: 'back' })
    }
  }, [state.currentStep, hasProjects])

  const askSkip = useCallback(() => setShowSkipConfirm(true), [])
  const confirmSkip = useCallback(() => {
    setShowSkipConfirm(false)
    setOnboardingComplete(true)
  }, [setOnboardingComplete])

  const handleFinish = useCallback(() => {
    setOnboardingComplete(true)
  }, [setOnboardingComplete])

  const handleTakeTour = useCallback(() => {
    setFeatureTourComplete(false)
    setOnboardingComplete(true)
  }, [setOnboardingComplete, setFeatureTourComplete])

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) setShowSkipConfirm(true)
  }, [])

  const step = STEPS[state.currentStep]
  const isLastStep = step === 'explore'

  return (
    <div
      className="ob-overlay"
      ref={containerRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ob-current-step-title"
      onClick={handleBackdropClick}
    >
      <OnboardingLayout
        currentStep={state.currentStep}
        totalSteps={TOTAL_STEPS}
        onBack={goBack}
        onContinue={isLastStep ? handleFinish : goNext}
        onSkip={askSkip}
        canContinue
        showBack={state.currentStep > 0}
        showSkip={!isLastStep}
        showContinue
        continueLabel={isLastStep ? t('onboarding.explore.finish') : undefined}
      >
        {step === 'welcome' && <WelcomeStep />}
        {step === 'model' && <ModelStep />}
        {step === 'theme' && <ThemeStep />}
        {step === 'notifications' && <NotificationStep />}
        {step === 'environment' && (
          <EnvironmentStep
            checks={state.checks}
            installAttempted={state.installAttempted}
            onRunChecks={runChecks}
            onInstall={installAndRecheck}
            onOpenExternal={shell.openExternal}
          />
        )}
        {step === 'project' && <ProjectStep />}
        {step === 'explore' && <ExploreStep onTakeTour={handleTakeTour} />}
      </OnboardingLayout>

      {showSkipConfirm && (
        <SkipConfirmDialog onSkip={confirmSkip} onCancel={() => setShowSkipConfirm(false)} />
      )}

      <GhAuthDialog
        isOpen={state.showGhAuthDialog}
        onClose={() => dispatch({ type: 'hide_gh_auth' })}
        onSuccess={handleGhAuthSuccess}
      />
    </div>
  )
}

// ── Export ────────────────────────────────────────────────────────────────────

export function OnboardingOverlay() {
  const onboardingComplete = useUIStore((s) => s.onboardingComplete)

  if (onboardingComplete) return null
  return createPortal(<OnboardingContent />, document.body)
}
