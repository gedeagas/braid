import { useReducer, useEffect, useCallback } from 'react'
import { SpotlightTour, type TourStep } from '@/components/ui/SpotlightTour'
import { useUIStore } from '@/store/ui'
import { useProjectsStore } from '@/store/projects'

// ── Tour step definitions ───────────────────────────────────────────────────

const TOUR_STEPS: TourStep[] = [
  {
    target: '[data-tour="sidebar"]',
    titleKey: 'tour.sidebar.title',
    descriptionKey: 'tour.sidebar.description',
    ns: 'common',
    placement: 'right',
    padding: 0,
    ensureVisible: () => {
      const { sidebarPanelOpen, toggleSidebar } = useUIStore.getState()
      if (!sidebarPanelOpen) toggleSidebar()
    },
  },
  {
    target: '[data-tour="add-worktree"]',
    titleKey: 'tour.addWorktree.title',
    descriptionKey: 'tour.addWorktree.description',
    ns: 'common',
    placement: 'right',
    padding: 6,
  },
  {
    target: '[data-tour="chat-panel"]',
    titleKey: 'tour.chatPanel.title',
    descriptionKey: 'tour.chatPanel.description',
    ns: 'common',
    placement: 'bottom',
    padding: 0,
  },
  {
    target: '[data-tour="session-tabs"]',
    titleKey: 'tour.sessionTabs.title',
    descriptionKey: 'tour.sessionTabs.description',
    ns: 'common',
    placement: 'bottom',
    padding: 4,
  },
  {
    target: '[data-tour="right-panel"]',
    titleKey: 'tour.rightPanel.title',
    descriptionKey: 'tour.rightPanel.description',
    ns: 'common',
    placement: 'left',
    padding: 4,
    ensureVisible: () => {
      const { rightPanelVisible, toggleRightPanel } = useUIStore.getState()
      if (!rightPanelVisible) toggleRightPanel()
    },
  },
  {
    target: '[data-tour="terminal"]',
    titleKey: 'tour.terminal.title',
    descriptionKey: 'tour.terminal.description',
    ns: 'common',
    placement: 'left',
    padding: 4,
    ensureVisible: () => {
      const { rightPanelVisible, toggleRightPanel } = useUIStore.getState()
      if (!rightPanelVisible) toggleRightPanel()
    },
  },
  {
    target: '[data-tour="mission-control"]',
    titleKey: 'tour.missionControl.title',
    descriptionKey: 'tour.missionControl.description',
    ns: 'common',
    placement: 'right',
    padding: 6,
    ensureVisible: () => {
      // MC button is always visible in the Activity Bar, just deactivate MC overlay
      const { missionControlActive, setMissionControlActive } = useUIStore.getState()
      if (missionControlActive) setMissionControlActive(false)
    },
  },
]

// ── Reducer ─────────────────────────────────────────────────────────────────

interface TourState {
  step: number
  active: boolean
}

type TourAction =
  | { type: 'START' }
  | { type: 'NEXT' }
  | { type: 'BACK' }
  | { type: 'STOP' }

function tourReducer(state: TourState, action: TourAction): TourState {
  switch (action.type) {
    case 'START': return { step: 0, active: true }
    case 'NEXT':  return { ...state, step: state.step + 1 }
    case 'BACK':  return { ...state, step: Math.max(0, state.step - 1) }
    case 'STOP':  return { step: 0, active: false }
  }
}

// ── Component ───────────────────────────────────────────────────────────────

export function FeatureTour() {
  const onboardingComplete = useUIStore((s) => s.onboardingComplete)
  const featureTourComplete = useUIStore((s) => s.featureTourComplete)
  const setFeatureTourComplete = useUIStore((s) => s.setFeatureTourComplete)
  const projects = useProjectsStore((s) => s.projects)

  const [state, dispatch] = useReducer(tourReducer, { step: 0, active: false })

  // Auto-trigger when conditions are met
  useEffect(() => {
    if (onboardingComplete && !featureTourComplete && projects.length > 0 && !state.active) {
      // Small delay to let the UI settle after onboarding/project add
      const timer = setTimeout(() => dispatch({ type: 'START' }), 800)
      return () => clearTimeout(timer)
    }
  }, [onboardingComplete, featureTourComplete, projects.length, state.active])

  const handleComplete = useCallback(() => {
    dispatch({ type: 'STOP' })
    setFeatureTourComplete(true)
  }, [setFeatureTourComplete])

  const handleSkip = useCallback(() => {
    dispatch({ type: 'STOP' })
    setFeatureTourComplete(true)
  }, [setFeatureTourComplete])

  if (!state.active) return null

  return (
    <SpotlightTour
      steps={TOUR_STEPS}
      currentStep={state.step}
      onNext={() => dispatch({ type: 'NEXT' })}
      onBack={() => dispatch({ type: 'BACK' })}
      onSkip={handleSkip}
      onComplete={handleComplete}
    />
  )
}
