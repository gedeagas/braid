import { useState, useEffect, useCallback, useRef, useReducer } from 'react'
import { createPortal } from 'react-dom'
import { CoachMark } from './CoachMark'

export interface TourStep {
  target: string
  titleKey: string
  descriptionKey: string
  ns: string
  placement: 'top' | 'bottom' | 'left' | 'right'
  padding?: number
  ensureVisible?: () => void
}

interface SpotlightTourProps {
  steps: TourStep[]
  currentStep: number
  onNext: () => void
  onBack: () => void
  onSkip: () => void
  onComplete: () => void
}

interface CutoutRect {
  x: number
  y: number
  width: number
  height: number
}

interface MarkPosition {
  top: number
  left: number
  placement: 'top' | 'bottom' | 'left' | 'right'
}

// ── Positioning helpers ─────────────────────────────────────────────────────

const COACH_MARK_GAP = 16
const COACH_MARK_WIDTH = 340
const COACH_MARK_HEIGHT_ESTIMATE = 200
const VIEWPORT_MARGIN = 12

function computeCoachMarkPosition(
  rect: CutoutRect,
  preferred: 'top' | 'bottom' | 'left' | 'right',
): MarkPosition {
  const vw = window.innerWidth
  const vh = window.innerHeight

  const tryPlacement = (p: typeof preferred): MarkPosition | null => {
    let top: number, left: number
    switch (p) {
      case 'right':
        top = rect.y
        left = rect.x + rect.width + COACH_MARK_GAP
        if (left + COACH_MARK_WIDTH > vw - VIEWPORT_MARGIN) return null
        break
      case 'left':
        top = rect.y
        left = rect.x - COACH_MARK_WIDTH - COACH_MARK_GAP
        if (left < VIEWPORT_MARGIN) return null
        break
      case 'bottom':
        top = rect.y + rect.height + COACH_MARK_GAP
        left = rect.x
        if (top + COACH_MARK_HEIGHT_ESTIMATE > vh - VIEWPORT_MARGIN) return null
        break
      case 'top':
        top = rect.y - COACH_MARK_HEIGHT_ESTIMATE - COACH_MARK_GAP
        left = rect.x
        if (top < VIEWPORT_MARGIN) return null
        break
    }
    // Clamp vertical
    top = Math.max(VIEWPORT_MARGIN, Math.min(top, vh - COACH_MARK_HEIGHT_ESTIMATE - VIEWPORT_MARGIN))
    // Clamp horizontal
    left = Math.max(VIEWPORT_MARGIN, Math.min(left, vw - COACH_MARK_WIDTH - VIEWPORT_MARGIN))
    return { top, left, placement: p }
  }

  // Try preferred, then fallbacks
  const fallbackOrder: typeof preferred[] =
    preferred === 'right' ? ['right', 'left', 'bottom', 'top'] :
    preferred === 'left' ? ['left', 'right', 'bottom', 'top'] :
    preferred === 'bottom' ? ['bottom', 'top', 'right', 'left'] :
    ['top', 'bottom', 'right', 'left']

  for (const p of fallbackOrder) {
    const pos = tryPlacement(p)
    if (pos) return pos
  }

  // Ultimate fallback — center below
  return {
    top: rect.y + rect.height + COACH_MARK_GAP,
    left: Math.max(VIEWPORT_MARGIN, (vw - COACH_MARK_WIDTH) / 2),
    placement: 'bottom',
  }
}

// ── Reducer for transition state ────────────────────────────────────────────

type Phase = 'measuring' | 'animating' | 'visible'
interface InternalState { phase: Phase; cutout: CutoutRect; mark: MarkPosition }
type InternalAction =
  | { type: 'MEASURE'; cutout: CutoutRect; mark: MarkPosition }
  | { type: 'ANIMATE_DONE' }

function internalReducer(state: InternalState, action: InternalAction): InternalState {
  switch (action.type) {
    case 'MEASURE':
      return { phase: 'animating', cutout: action.cutout, mark: action.mark }
    case 'ANIMATE_DONE':
      return { ...state, phase: 'visible' }
  }
}

const INITIAL_CUTOUT: CutoutRect = { x: 0, y: 0, width: 0, height: 0 }
const INITIAL_MARK: MarkPosition = { top: 0, left: 0, placement: 'right' }

// ── Component ───────────────────────────────────────────────────────────────

export function SpotlightTour({
  steps,
  currentStep,
  onNext,
  onBack,
  onSkip,
  onComplete,
}: SpotlightTourProps) {
  const [exiting, setExiting] = useState(false)
  const [internal, dispatch] = useReducer(internalReducer, {
    phase: 'measuring',
    cutout: INITIAL_CUTOUT,
    mark: INITIAL_MARK,
  })

  const prevStepRef = useRef(-1)
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const step = steps[currentStep]
  if (!step) return null

  // ── Measure target element and compute positions ──────────────────────────

  const measure = useCallback(() => {
    const step = steps[currentStep]
    if (!step) return

    step.ensureVisible?.()

    requestAnimationFrame(() => {
      const el = document.querySelector(step.target)
      if (!el) {
        // Skip to next step if target not found
        console.warn('[SpotlightTour] Target not found:', step.target)
        if (currentStep < steps.length - 1) onNext()
        else onComplete()
        return
      }

      const rect = el.getBoundingClientRect()
      const pad = step.padding ?? 8
      const cutout: CutoutRect = {
        x: rect.left - pad,
        y: rect.top - pad,
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
      }
      const mark = computeCoachMarkPosition(cutout, step.placement)
      dispatch({ type: 'MEASURE', cutout, mark })
    })
  }, [currentStep, steps, onNext, onComplete])

  // ── Trigger measure on step change ────────────────────────────────────────

  useEffect(() => {
    if (prevStepRef.current !== currentStep) {
      prevStepRef.current = currentStep
      measure()
    }
  }, [currentStep, measure])

  // ── Window resize handler ─────────────────────────────────────────────────

  useEffect(() => {
    const handleResize = () => {
      clearTimeout(resizeTimerRef.current)
      resizeTimerRef.current = setTimeout(measure, 100)
    }
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
      clearTimeout(resizeTimerRef.current)
    }
  }, [measure])

  // ── Keyboard navigation ───────────────────────────────────────────────────

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          e.preventDefault()
          handleSkip()
          break
        case 'ArrowRight':
        case 'Enter':
          e.preventDefault()
          handleNext()
          break
        case 'ArrowLeft':
          e.preventDefault()
          if (currentStep > 0) onBack()
          break
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  })

  // ── Transition end → show coach mark ──────────────────────────────────────

  const handleCutoutTransitionEnd = useCallback(() => {
    if (internal.phase === 'animating') {
      dispatch({ type: 'ANIMATE_DONE' })
    }
  }, [internal.phase])

  // Also auto-show after a brief delay in case transitionend doesn't fire
  useEffect(() => {
    if (internal.phase === 'animating') {
      const timer = setTimeout(() => dispatch({ type: 'ANIMATE_DONE' }), 350)
      return () => clearTimeout(timer)
    }
  }, [internal.phase])

  // ── Exit animation ────────────────────────────────────────────────────────

  const handleComplete = useCallback(() => {
    setExiting(true)
    setTimeout(onComplete, 200)
  }, [onComplete])

  const handleSkip = useCallback(() => {
    setExiting(true)
    setTimeout(onSkip, 200)
  }, [onSkip])

  const handleNext = useCallback(() => {
    if (currentStep >= steps.length - 1) handleComplete()
    else onNext()
  }, [currentStep, steps.length, onNext, handleComplete])

  // ── Render ────────────────────────────────────────────────────────────────

  const { cutout, mark } = internal
  const isFirstRender = prevStepRef.current === 0 && internal.phase === 'measuring'

  const overlayClass = [
    'spotlight-overlay',
    isFirstRender ? 'spotlight-overlay--entering' : '',
    exiting ? 'spotlight-overlay--exiting' : '',
  ].filter(Boolean).join(' ')

  return createPortal(
    <div className={overlayClass}>
      <svg className="spotlight-svg">
        <defs>
          <mask id="spotlight-mask">
            <rect width="100%" height="100%" fill="white" />
            <rect
              x={cutout.x}
              y={cutout.y}
              width={cutout.width}
              height={cutout.height}
              rx={8}
              fill="black"
              style={{ transition: 'all 0.3s ease-in-out' }}
              onTransitionEnd={handleCutoutTransitionEnd}
            />
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.55)"
          mask="url(#spotlight-mask)"
        />
      </svg>

      <CoachMark
        titleKey={step.titleKey}
        descriptionKey={step.descriptionKey}
        ns={step.ns}
        currentStep={currentStep}
        totalSteps={steps.length}
        placement={mark.placement}
        position={{ top: mark.top, left: mark.left }}
        visible={internal.phase === 'visible' && !exiting}
        onNext={handleNext}
        onBack={onBack}
        onSkip={handleSkip}
        isLast={currentStep >= steps.length - 1}
      />
    </div>,
    document.body,
  )
}
