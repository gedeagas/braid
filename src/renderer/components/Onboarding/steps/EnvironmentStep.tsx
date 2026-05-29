import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Spinner } from '@/components/ui/Spinner'
import { Button } from '@/components/ui/Button'
import { IconGitHub } from '@/components/shared/icons'

export type CheckKey = 'git' | 'gh' | 'ghAuth' | 'acli'
export type CheckStatus = 'pending' | 'checking' | 'ok' | 'fail' | 'installing'

function StatusBadge({ status }: { status: CheckStatus }) {
  const { t } = useTranslation('common')
  if (status === 'checking' || status === 'installing' || status === 'pending') {
    return <span className="ob-int-badge ob-int-badge--checking"><Spinner size="sm" /></span>
  }
  if (status === 'ok') {
    return (
      <span className="ob-int-badge ob-int-badge--connected">
        <span className="ob-int-badge-dot ob-int-badge-dot--green" />
        {t('onboarding.integrations.connected')}
      </span>
    )
  }
  return null
}

function GitHubCard({
  ghStatus,
  authStatus,
  onInstall,
  onRecheck,
  hostPlatform,
}: {
  ghStatus: CheckStatus
  authStatus: CheckStatus
  onInstall: (key: CheckKey) => void
  onRecheck: () => void
  hostPlatform: string
}) {
  const { t } = useTranslation('common')
  const connected = ghStatus === 'ok' && authStatus === 'ok'
  const busy = ghStatus === 'checking' || ghStatus === 'installing' || authStatus === 'checking' || authStatus === 'installing'
  const effectiveStatus: CheckStatus = connected ? 'ok' : busy ? 'checking' : ghStatus === 'pending' ? 'pending' : 'fail'
  const isLinux = hostPlatform === 'linux'
  const canAutoInstallGh = hostPlatform === 'darwin'

  return (
    <div className="ob-int-card">
      <div className="ob-int-card-icon">
        <IconGitHub size={22} />
      </div>
      <div className="ob-int-card-body">
        <div className="ob-int-card-header">
          <span className="ob-int-card-name">GitHub</span>
          <StatusBadge status={effectiveStatus} />
        </div>
        <span className="ob-int-card-desc">{t('onboarding.integrations.ghDesc')}</span>
        {ghStatus === 'fail' && isLinux && (
          <span className="ob-int-card-desc">{t('onboarding.doctor.ghInstallHintLinux')}</span>
        )}
      </div>
      {!connected && !busy && (
        <div className="ob-int-card-actions">
          {ghStatus === 'fail' && canAutoInstallGh && (
            <Button size="sm" onClick={() => onInstall('gh')}>
              {t('onboarding.doctor.install')}
            </Button>
          )}
          {ghStatus === 'ok' && authStatus === 'fail' && (
            <Button size="sm" onClick={() => onInstall('ghAuth')}>
              {t('onboarding.integrations.connect')}
            </Button>
          )}
          <Button size="sm" onClick={onRecheck}>
            {t('onboarding.integrations.recheck')}
          </Button>
        </div>
      )}
    </div>
  )
}

function JiraCard({
  status,
  onInstall,
  onRecheck,
}: {
  status: CheckStatus
  onInstall: (key: CheckKey) => void
  onRecheck: () => void
}) {
  const { t } = useTranslation('common')
  const connected = status === 'ok'
  const busy = status === 'checking' || status === 'installing'

  return (
    <div className="ob-int-card">
      <div className="ob-int-card-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M11.53 2c0 4.97 3.03 8 8 8h.47c0 4.97-3.03 8-8 8-.97 0-2 .5-2 2s1.03 2 2 2c6.63 0 12-5.37 12-12S18.63-2 12-2c-.97 0-2 .5-2 2s1.03 2 1.53 2z" fill="#2684FF" transform="translate(0 2)"/>
          <path d="M12.47 22c0-4.97-3.03-8-8-8H4c0-4.97 3.03-8 8-8 .97 0 2-.5 2-2s-1.03-2-2-2C5.37 2 0 7.37 0 14s5.37 12 12 12c.97 0 2-.5 2-2s-1.03-2-1.53-2z" fill="#2684FF" opacity="0.65" transform="translate(0 -2)"/>
        </svg>
      </div>
      <div className="ob-int-card-body">
        <div className="ob-int-card-header">
          <span className="ob-int-card-name">Jira</span>
          <StatusBadge status={status} />
        </div>
        <span className="ob-int-card-desc">{t('onboarding.integrations.jiraDesc')}</span>
      </div>
      {!connected && !busy && (
        <div className="ob-int-card-actions">
          {status === 'fail' && (
            <Button size="sm" onClick={() => onInstall('acli')}>
              {t('onboarding.doctor.install')}
            </Button>
          )}
          <Button size="sm" onClick={onRecheck}>
            {t('onboarding.integrations.recheck')}
          </Button>
        </div>
      )}
    </div>
  )
}

interface Props {
  checks: Record<CheckKey, CheckStatus>
  onRunChecks: () => void
  onInstall: (key: CheckKey) => void
  hostPlatform: string
}

export function EnvironmentStep({ checks, onRunChecks, onInstall, hostPlatform }: Props) {
  const { t } = useTranslation('common')
  const isLinux = hostPlatform === 'linux'
  const canAutoInstallGit = hostPlatform === 'darwin'

  useEffect(() => { onRunChecks() }, [onRunChecks])

  return (
    <div className="ob-step">
      <h1 className="ob-heading">{t('onboarding.integrations.title')}</h1>
      <p className="ob-subtitle">{t('onboarding.integrations.subtitle')}</p>

      <ul className="ob-int-benefits">
        <li>{t('onboarding.integrations.benefit1')}</li>
        <li>{t('onboarding.integrations.benefit2')}</li>
        <li>{t('onboarding.integrations.benefit3')}</li>
      </ul>

      <div className="ob-int-list">
        <div className="ob-int-card ob-int-card--compact">
          <div className="ob-int-card-icon">
            <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
              <path d="M15.698 7.287L8.712.302a1.03 1.03 0 0 0-1.457 0l-1.45 1.45 1.84 1.84a1.223 1.223 0 0 1 1.548 1.56l1.773 1.774a1.224 1.224 0 1 1-.733.693L8.52 5.905v3.978a1.225 1.225 0 1 1-1.008-.036V5.836a1.225 1.225 0 0 1-.665-1.607L5.02 2.4.302 7.12a1.03 1.03 0 0 0 0 1.457l6.986 6.986a1.03 1.03 0 0 0 1.457 0l6.953-6.953a1.031 1.031 0 0 0 0-1.457" />
            </svg>
          </div>
          <div className="ob-int-card-body">
            <span className="ob-int-card-name">Git</span>
            <span className="ob-int-card-desc">{t('onboarding.integrations.gitDesc')}</span>
            {checks.git === 'fail' && isLinux && (
              <span className="ob-int-card-desc">{t('onboarding.doctor.gitInstallHintLinux')}</span>
            )}
          </div>
          <StatusBadge status={checks.git} />
          {checks.git === 'fail' && canAutoInstallGit && (
            <Button size="sm" onClick={() => onInstall('git')}>
              {t('onboarding.doctor.install')}
            </Button>
          )}
        </div>

        <GitHubCard
          ghStatus={checks.gh}
          authStatus={checks.ghAuth}
          onInstall={onInstall}
          onRecheck={onRunChecks}
          hostPlatform={hostPlatform}
        />
        <JiraCard
          status={checks.acli}
          onInstall={onInstall}
          onRecheck={onRunChecks}
        />
      </div>
    </div>
  )
}
