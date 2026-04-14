import { useReducer, useEffect, useCallback, useRef } from 'react'
import { SpotlightTour, type TourStep } from '@/components/ui/SpotlightTour'
import { useUIStore } from '@/store/ui'

// ── Tour step definitions ───────────────────────────────────────────────────

/** Steps shown on the device-list phase (before connecting). */
const DEVICE_LIST_STEPS: TourStep[] = [
  {
    target: '[data-tour="simulator-view"]',
    titleKey: 'tour.simulator.intro.title',
    descriptionKey: 'tour.simulator.intro.description',
    ns: 'common',
    placement: 'left',
    padding: 0,
  },
  {
    target: '[data-tour="simulator-header"]',
    titleKey: 'tour.simulator.devices.title',
    descriptionKey: 'tour.simulator.devices.description',
    ns: 'common',
    placement: 'bottom',
    padding: 4,
  },
  {
    target: '[data-tour="simulator-devices"]',
    titleKey: 'tour.simulator.connect.title',
    descriptionKey: 'tour.simulator.connect.description',
    ns: 'common',
    placement: 'left',
    padding: 4,
  },
]

/**
 * Fallback steps when no device list is visible (loading / no-cli / empty).
 * Only shows the overview step on the full view.
 */
const FALLBACK_STEPS: TourStep[] = [
  {
    target: '[data-tour="simulator-view"]',
    titleKey: 'tour.simulator.intro.title',
    descriptionKey: 'tour.simulator.intro.description',
    ns: 'common',
    placement: 'left',
    padding: 0,
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

export function SimulatorTour() {
  const rightPanelTab = useUIStore((s) => s.rightPanelTab)
  const simulatorTourComplete = useUIStore((s) => s.simulatorTourComplete)
  const setSimulatorTourComplete = useUIStore((s) => s.setSimulatorTourComplete)

  const [state, dispatch] = useReducer(tourReducer, { step: 0, active: false })
  const hasTriggered = useRef(false)

  // Trigger when user first visits the simulator tab
  useEffect(() => {
    if (
      rightPanelTab === 'simulator' &&
      !simulatorTourComplete &&
      !state.active &&
      !hasTriggered.current
    ) {
      hasTriggered.current = true
      // Delay to let the simulator view mount and load
      const timer = setTimeout(() => dispatch({ type: 'START' }), 600)
      return () => clearTimeout(timer)
    }
  }, [rightPanelTab, simulatorTourComplete, state.active])

  const handleComplete = useCallback(() => {
    dispatch({ type: 'STOP' })
    setSimulatorTourComplete(true)
  }, [setSimulatorTourComplete])

  const handleSkip = useCallback(() => {
    dispatch({ type: 'STOP' })
    setSimulatorTourComplete(true)
  }, [setSimulatorTourComplete])

  if (!state.active) return null

  // Pick steps based on whether the device list is visible
  const hasDeviceList = !!document.querySelector('[data-tour="simulator-devices"]')
  const steps = hasDeviceList ? DEVICE_LIST_STEPS : FALLBACK_STEPS

  return (
    <SpotlightTour
      steps={steps}
      currentStep={state.step}
      onNext={() => dispatch({ type: 'NEXT' })}
      onBack={() => dispatch({ type: 'BACK' })}
      onSkip={handleSkip}
      onComplete={handleComplete}
    />
  )
}
