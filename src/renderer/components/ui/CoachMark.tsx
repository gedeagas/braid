import { useTranslation } from 'react-i18next'
import { Button } from './Button'

interface CoachMarkProps {
  titleKey: string
  descriptionKey: string
  ns: string
  currentStep: number
  totalSteps: number
  placement: 'top' | 'bottom' | 'left' | 'right'
  position: { top: number; left: number }
  visible: boolean
  onNext: () => void
  onBack: () => void
  onSkip: () => void
  isLast: boolean
}

export function CoachMark({
  titleKey,
  descriptionKey,
  ns,
  currentStep,
  totalSteps,
  placement,
  position,
  visible,
  onNext,
  onBack,
  onSkip,
  isLast,
}: CoachMarkProps) {
  const { t } = useTranslation(ns)
  const { t: tCommon } = useTranslation('common')

  return (
    <div
      className={`coach-mark coach-mark--${placement}${visible ? ' coach-mark--visible' : ''}`}
      style={{ top: position.top, left: position.left }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className={`coach-mark__arrow`} />
      <h3 className="coach-mark__title">{t(titleKey)}</h3>
      <p className="coach-mark__description">{t(descriptionKey)}</p>

      <div className="coach-mark__footer">
        <div className="coach-mark__dots">
          {Array.from({ length: totalSteps }, (_, i) => (
            <div
              key={i}
              className={`coach-mark__dot${i === currentStep ? ' coach-mark__dot--active' : ''}`}
            />
          ))}
        </div>

        <div className="coach-mark__actions">
          <button className="coach-mark__skip" onClick={onSkip}>
            {tCommon('tour.skip')}
          </button>
          {currentStep > 0 && (
            <Button size="sm" onClick={onBack}>
              {tCommon('tour.back')}
            </Button>
          )}
          <Button variant="primary" size="sm" onClick={onNext}>
            {isLast ? tCommon('tour.done') : tCommon('tour.next')}
          </Button>
        </div>
      </div>
    </div>
  )
}
