import { useTranslation } from 'react-i18next'
import type { McpServerEntry, McpServerSource, McpStdioConfig, McpSseConfig, McpHttpConfig, McpHealthStatus } from '@/types'
import { Spinner } from '@/components/ui'

// ── Helpers ──────────────────────────────────────────────────────────────────

export function serverPreview(cfg: McpServerEntry['config']): string {
  if (cfg.type === 'stdio' || !cfg.type) {
    const stdio = cfg as McpStdioConfig
    return `${stdio.command} ${(stdio.args ?? []).join(' ')}`.trim()
  }
  return (cfg as McpSseConfig | McpHttpConfig).url
}

export function sourceFile(source?: McpServerSource): string | undefined {
  if (!source || source.kind === 'plugin') return undefined
  return source.file
}

/** Returns true if the server comes from an editable source (settings.json, claude.json) or has no source tag. */
export function isEditable(server: McpServerEntry): boolean {
  const file = sourceFile(server.source)
  return !file || file === 'settings.json' || file === 'claude.json'
}

// ── Status indicator ─────────────────────────────────────────────────────────

export function McpStatusDot({ status, checking }: { status?: McpHealthStatus; checking: boolean }) {
  const { t } = useTranslation('settings')

  if (checking) {
    return <Spinner size="sm" />
  }

  if (!status) return null

  const map: Record<McpHealthStatus, { cls: string; label: string }> = {
    ok: { cls: 'settings-mcp-status--ok', label: t('claudeMcp.status.ok') },
    error: { cls: 'settings-mcp-status--error', label: t('claudeMcp.status.error') },
    auth_required: { cls: 'settings-mcp-status--auth', label: t('claudeMcp.status.authRequired') },
    unknown: { cls: 'settings-mcp-status--unknown', label: t('claudeMcp.status.unknown') },
  }

  const info = map[status]
  return (
    <span className={`settings-mcp-status-dot ${info.cls}`} title={info.label} />
  )
}

// ── Read-only row for project / plugin servers ───────────────────────────────

export function ReadOnlyMcpRow({
  server,
  healthStatus,
  healthError,
  checking,
}: {
  server: McpServerEntry
  healthStatus?: McpHealthStatus
  healthError?: string
  checking: boolean
}) {
  const { t } = useTranslation('settings')
  const cfg = server.config
  const source = server.source

  return (
    <div className="settings-mcp-row settings-mcp-row--readonly">
      <div className="settings-mcp-row-left">
        <McpStatusDot status={healthStatus} checking={checking} />
        <div className="settings-mcp-info">
          <div className="settings-mcp-name-row">
            <span className="settings-mcp-name">{server.name}</span>
            <span className={`settings-mcp-type-badge settings-mcp-type-badge--${cfg.type ?? 'stdio'}`}>
              {t(`claudeMcp.typeBadge.${cfg.type ?? 'stdio'}`)}
            </span>
            {source?.kind === 'plugin' && (
              <span className="settings-mcp-source-badge settings-mcp-source-badge--plugin">
                {source.pluginName}
              </span>
            )}
            {sourceFile(source) && (
              <span className="settings-mcp-source-badge settings-mcp-source-badge--file">
                {sourceFile(source)}
              </span>
            )}
          </div>
          <span className="settings-mcp-command">{serverPreview(cfg)}</span>
          {healthError && healthStatus !== 'ok' && (
            <span className="settings-mcp-error-hint">{healthError}</span>
          )}
        </div>
      </div>
      {healthStatus === 'auth_required' && (
        <div className="settings-mcp-actions">
          <span className="settings-mcp-auth-badge">{t('claudeMcp.authNeeded')}</span>
        </div>
      )}
    </div>
  )
}
