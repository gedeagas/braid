import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { BrowserAgentBridgeStatus } from '@shared/browser'
import * as ipc from '@/lib/ipc'

const MCP_AGENT_NAMES: Record<string, string> = {
  claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI', cursor: 'Cursor', copilot: 'GitHub Copilot',
}

/** Where the braid-browser skill / MCP server ended up, per agent. */
export function AgentBridgeStatusList({ refreshKey }: { refreshKey: string }) {
  const { t } = useTranslation('settings')
  const [status, setStatus] = useState<BrowserAgentBridgeStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    // Settings are applied in main right before this runs; give it a beat to finish.
    const id = setTimeout(() => {
      ipc.browser.agentBridgeStatus().then((s) => { if (!cancelled) setStatus(s) }).catch(() => {})
    }, 150)
    return () => { cancelled = true; clearTimeout(id) }
  }, [refreshKey])

  if (!status || (status.skills.length === 0 && status.mcpAgents.length === 0)) return null
  return (
    <div className="settings-card browser-agent-status">
      {status.skills.map((s) => (
        <div key={s.path} className="browser-agent-status-row">
          <span className="browser-agent-status-agent" title={s.agents.join(', ')}>
            {s.agent === 'shared'
              ? t('browser.sharedFolder', {
                  agents: s.agents.slice(0, 3).join(', ') + (s.agents.length > 3 ? ` ${t('browser.andMore', { count: s.agents.length - 3 })}` : ''),
                })
              : s.agents.join(', ')}
          </span>
          <span className={`browser-agent-status-outcome browser-agent-status-outcome--${s.outcome}`}>
            {t(`browser.skillOutcome.${s.outcome}`)}
          </span>
          <span className="browser-agent-status-path" title={s.error ?? s.path}>{s.path}</span>
        </div>
      ))}
      {status.mcpAgents.length > 0 && (
        <span className="settings-hint">{t('browser.mcpRegisteredFor', { agents: status.mcpAgents.map((a) => MCP_AGENT_NAMES[a] ?? a).join(', ') })}</span>
      )}
    </div>
  )
}
