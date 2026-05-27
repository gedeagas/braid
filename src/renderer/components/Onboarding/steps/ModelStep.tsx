import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/store/ui'
import { useDetectedAgents } from '@/lib/agentDetection'
import { AGENT_CATALOG, type AgentCatalogEntry } from '@/lib/agentCatalog'
import { AgentIcon } from '@/components/shared/icons/AgentIcons'
import { IconCheckFill } from '@/components/shared/icons'

function AgentCard({
  agent,
  isActive,
  onSelect,
}: {
  agent: AgentCatalogEntry
  isActive: boolean
  onSelect: () => void
}) {
  return (
    <button
      className={`ob-agent-card${isActive ? ' ob-agent-card--active' : ''}`}
      onClick={onSelect}
      aria-pressed={isActive}
    >
      {isActive && (
        <div className="ob-agent-check">
          <IconCheckFill size={14} />
        </div>
      )}
      <div className="ob-agent-icon">
        <AgentIcon agentId={agent.id} size={20} />
      </div>
      <div className="ob-agent-info">
        <span className="ob-agent-name">{agent.label}</span>
        <span className="ob-agent-cmd">{agent.detectCmd}</span>
      </div>
    </button>
  )
}

export function ModelStep() {
  const { t } = useTranslation('common')
  const defaultAgentId = useUIStore((s) => s.defaultAgentId)
  const setDefaultAgentId = useUIStore((s) => s.setDefaultAgentId)
  const detected = useDetectedAgents()
  const [showAll, setShowAll] = useState(false)

  const detectedIds = new Set(detected.map((a) => a.id))
  const undetected = AGENT_CATALOG.filter((a) => !detectedIds.has(a.id))

  return (
    <div className="ob-step">
      <span className="ob-eyebrow">{t('onboarding.welcome.eyebrow')}</span>
      <h1 className="ob-heading">{t('onboarding.agent.title')}</h1>
      <p className="ob-subtitle">{t('onboarding.agent.subtitle')}</p>

      {detected.length > 0 && (
        <>
          <div className="ob-detected-label">
            <span className="ob-detected-dot" />
            {t('onboarding.agent.detected', { count: detected.length })}
          </div>
          <div className="ob-agent-grid">
            {detected.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                isActive={agent.id === defaultAgentId}
                onSelect={() => setDefaultAgentId(agent.id)}
              />
            ))}
          </div>
        </>
      )}

      {showAll && (
        <div className="ob-agent-grid">
          {undetected.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              isActive={agent.id === defaultAgentId}
              onSelect={() => setDefaultAgentId(agent.id)}
            />
          ))}
        </div>
      )}

      {!showAll && undetected.length > 0 && (
        <button className="ob-show-more" onClick={() => setShowAll(true)}>
          {t('onboarding.agent.showMore', { count: undetected.length })}
        </button>
      )}
    </div>
  )
}
