import { useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { IconSparkle, IconArrowLeft } from '@/components/shared/icons'

const STEP_LABEL_KEYS = [
  'onboarding.stepLabel.welcome',
  'onboarding.stepLabel.agent',
  'onboarding.stepLabel.theme',
  'onboarding.stepLabel.notifications',
  'onboarding.stepLabel.integrations',
  'onboarding.stepLabel.project',
  'onboarding.stepLabel.explore',
]

interface Props {
  currentStep: number
  totalSteps: number
  onBack: () => void
  onContinue: () => void
  onSkip: () => void
  canContinue?: boolean
  showBack?: boolean
  showSkip?: boolean
  showContinue?: boolean
  continueLabel?: string
  children: React.ReactNode
}

export function OnboardingLayout({
  currentStep,
  totalSteps,
  onBack,
  onContinue,
  onSkip,
  canContinue = true,
  showBack = true,
  showSkip = true,
  showContinue = true,
  continueLabel,
  children,
}: Props) {
  const { t } = useTranslation('common')

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canContinue && showContinue) {
        e.preventDefault()
        onContinue()
      }
    },
    [canContinue, showContinue, onContinue],
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return (
    <div className="ob-layout" onClick={(e) => e.stopPropagation()}>
      <div className="ob-layout-header">
        <div className="ob-brand">
          <IconSparkle size={24} />
          <span className="ob-brand-name">Braid</span>
        </div>
      </div>

      <div className="ob-progress-row">
        <div className="ob-progress-bar">
          {Array.from({ length: totalSteps }, (_, i) => (
            <div
              key={i}
              className={`ob-progress-segment${
                i < currentStep
                  ? ' ob-progress-segment--done'
                  : i === currentStep
                    ? ' ob-progress-segment--active'
                    : ''
              }`}
              title={STEP_LABEL_KEYS[i] ? t(STEP_LABEL_KEYS[i]) : undefined}
            />
          ))}
        </div>
        <span className="ob-progress-counter">
          {currentStep + 1} {t('onboarding.of')} {totalSteps}
        </span>
      </div>

      <div className="ob-content">{children}</div>

      <div className="ob-footer">
        <div className="ob-footer-left">
          {showSkip && (
            <button className="ob-skip-link" onClick={onSkip}>
              {t('onboarding.skipSetup')}
            </button>
          )}
        </div>
        <div className="ob-footer-right">
          {showBack && currentStep > 0 && (
            <Button onClick={onBack}>
              <IconArrowLeft size={12} />
              {t('onboarding.back')}
            </Button>
          )}
          {showContinue && (
            <Button variant="primary" onClick={onContinue} disabled={!canContinue}>
              {continueLabel ?? t('onboarding.continue')}
              <kbd className="ob-kbd">&#8984;&#9166;</kbd>
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
