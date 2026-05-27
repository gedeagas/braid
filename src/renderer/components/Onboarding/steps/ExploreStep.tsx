import { useTranslation } from 'react-i18next'
import { IconChevronRight } from '@/components/shared/icons'

interface Props {
  onTakeTour: () => void
}

export function ExploreStep({ onTakeTour }: Props) {
  const { t } = useTranslation('common')

  return (
    <div className="ob-step">
      <h1 className="ob-heading">{t('onboarding.explore.title')}</h1>
      <p className="ob-subtitle">{t('onboarding.explore.subtitle')}</p>

      <div className="ob-explore-preview">
        <div className="ob-explore-feature-list">
          <div className="ob-explore-feature">
            <span className="ob-explore-feature-dot" />
            <span>{t('onboarding.explore.feature1')}</span>
          </div>
          <div className="ob-explore-feature">
            <span className="ob-explore-feature-dot" />
            <span>{t('onboarding.explore.feature2')}</span>
          </div>
          <div className="ob-explore-feature">
            <span className="ob-explore-feature-dot" />
            <span>{t('onboarding.explore.feature3')}</span>
          </div>
          <div className="ob-explore-feature">
            <span className="ob-explore-feature-dot" />
            <span>{t('onboarding.explore.feature4')}</span>
          </div>
        </div>
      </div>

      <button className="ob-tour-btn" onClick={onTakeTour}>
        {t('onboarding.explore.takeTour')} <IconChevronRight size={12} />
      </button>
    </div>
  )
}
