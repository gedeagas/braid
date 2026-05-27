import { useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { IconArrowLeft, IconCheckFill } from '@/components/shared/icons'
import braidLogoUrl from '../../../../build/icon.svg?url'

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
  const currentStepLabel = STEP_LABEL_KEYS[currentStep] ? t(STEP_LABEL_KEYS[currentStep]) : ''

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
      <aside className="ob-sidebar" aria-label={t('onboarding.welcome.title')}>
        <div className="ob-brand">
          <span className="ob-brand-mark">
            <img src={braidLogoUrl} alt="" className="ob-brand-logo" aria-hidden="true" />
          </span>
          <span className="ob-brand-name">Braid</span>
        </div>

        <div className="ob-rail-summary">
          <span className="ob-rail-kicker">{t('onboarding.welcome.eyebrow')}</span>
          <span className="ob-rail-counter">
            {currentStep + 1} {t('onboarding.of')} {totalSteps}
          </span>
        </div>

        <ol className="ob-step-rail">
          {Array.from({ length: totalSteps }, (_, i) => (
            <li
              key={i}
              className={`ob-rail-step${
                i < currentStep
                  ? ' ob-rail-step--done'
                  : i === currentStep
                    ? ' ob-rail-step--active'
                    : ''
              }`}
              aria-current={i === currentStep ? 'step' : undefined}
            >
              <span className="ob-rail-node">
                {i < currentStep ? <IconCheckFill size={10} /> : i + 1}
              </span>
              <span className="ob-rail-label">
                {STEP_LABEL_KEYS[i] ? t(STEP_LABEL_KEYS[i]) : ''}
              </span>
            </li>
          ))}
        </ol>
      </aside>

      <section className="ob-panel">
        <span id="ob-current-step-title" className="ob-sr-only">
          {currentStepLabel}
        </span>

        <div className="ob-mobile-progress">
          <div className="ob-progress-bar" aria-hidden="true">
            {Array.from({ length: totalSteps }, (_, i) => (
              <span
                key={i}
                className={`ob-progress-segment${
                  i < currentStep
                    ? ' ob-progress-segment--done'
                    : i === currentStep
                      ? ' ob-progress-segment--active'
                      : ''
                }`}
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
      </section>
    </div>
  )
}
