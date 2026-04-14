import { useReducer, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import * as ipc from '@/lib/ipc'
import { useProjectsStore } from '@/store/projects'
import { useUIStore } from '@/store/ui'
import type { McpServerEntry } from '@/types'
import { reducer, emptyForm, validateForm, formToConfig } from './mcpReducer'
import { Toggle } from '@/components/shared/Toggle'
import { McpStatusDot, ReadOnlyMcpRow, serverPreview, isEditable } from './McpServerRow'
import { McpServerForm } from './McpServerForm'

// ── Main component ───────────────────────────────────────────────────────────

export function SettingsClaudeMcp() {
  const { t } = useTranslation('settings')

  // Resolve active project path for reading project .mcp.json
  const selectedProjectId = useUIStore((s) => s.selectedProjectId)
  const projectPath = useProjectsStore((s) => {
    const p = s.projects.find((proj) => proj.id === selectedProjectId)
    return p?.path ?? null
  })

  const [state, dispatch] = useReducer(reducer, {
    servers: [], projectServers: [], pluginServers: [],
    loading: true, editingName: null,
    form: emptyForm(), pendingDeleteName: null, saving: false,
    health: {}, healthChecking: false, authenticatingServer: null,
  })

  const formRef = useRef<HTMLDivElement>(null)

  // Load user servers
  useEffect(() => {
    dispatch({ type: 'setLoading', loading: true })
    ipc.claudeConfig.getMcpServers()
      .then((servers) => dispatch({ type: 'setServers', servers }))
      .finally(() => dispatch({ type: 'setLoading', loading: false }))
  }, [])

  // Load plugin servers
  useEffect(() => {
    ipc.claudeConfig.getPluginMcpServers()
      .then((servers) => dispatch({ type: 'setPluginServers', servers }))
      .catch(() => dispatch({ type: 'setPluginServers', servers: [] }))
  }, [])

  // Load project servers (re-fetches when active project changes)
  useEffect(() => {
    if (!projectPath) {
      dispatch({ type: 'setProjectServers', servers: [] })
      return
    }
    ipc.claudeConfig.getProjectMcpServers(projectPath)
      .then((servers) => dispatch({ type: 'setProjectServers', servers }))
      .catch(() => dispatch({ type: 'setProjectServers', servers: [] }))
  }, [projectPath])

  // Run health checks when servers are loaded
  const runHealthCheck = useCallback(() => {
    const allServers = [
      ...state.servers,
      ...state.projectServers,
      ...state.pluginServers,
    ].filter((s) => s.enabled)

    if (allServers.length === 0) return

    dispatch({ type: 'setHealthChecking', checking: true })
    ipc.claudeConfig.checkMcpHealth(
      allServers.map((s) => ({ name: s.name, config: s.config })),
    )
      .then((results) => dispatch({ type: 'setHealthResults', results }))
      .catch(() => dispatch({ type: 'setHealthChecking', checking: false }))
  }, [state.servers, state.projectServers, state.pluginServers])

  // Auto-check health once servers are loaded
  useEffect(() => {
    if (state.loading) return
    const totalEnabled = [...state.servers, ...state.projectServers, ...state.pluginServers]
      .filter((s) => s.enabled).length
    if (totalEnabled > 0) {
      runHealthCheck()
    }
  }, [state.loading]) // eslint-disable-line react-hooks/exhaustive-deps

  // Only persist editable servers (settings.json) - never include settings.local.json entries
  const persistEditable = useCallback((servers: McpServerEntry[]) => {
    ipc.claudeConfig.setMcpServers(servers.filter(isEditable)).catch(console.error)
  }, [])

  // Persist on toggle
  const handleToggle = useCallback((name: string) => {
    dispatch({ type: 'toggleServer', name })
    const updated = state.servers.map((s) => s.name === name ? { ...s, enabled: !s.enabled } : s)
    persistEditable(updated)
  }, [state.servers, persistEditable])

  // Persist on delete
  const handleDelete = useCallback((name: string) => {
    dispatch({ type: 'deleteServer', name })
    const updated = state.servers.filter((s) => s.name !== name)
    persistEditable(updated)
  }, [state.servers, persistEditable])

  // Save form
  const handleSave = useCallback(() => {
    const validated = validateForm(state.form, state.servers, state.editingName)
    if (validated.nameError || validated.commandError || validated.urlError) {
      dispatch({ type: 'setFormField', field: 'nameError', value: validated.nameError })
      dispatch({ type: 'setFormField', field: 'commandError', value: validated.commandError })
      dispatch({ type: 'setFormField', field: 'urlError', value: validated.urlError })
      return
    }
    dispatch({ type: 'saveServer' })
    const entry: McpServerEntry = {
      name: validated.name.trim(),
      enabled: true,
      config: formToConfig(validated),
    }
    const updated = state.editingName === ''
      ? [...state.servers, entry]
      : state.servers.map((s) => s.name === state.editingName ? entry : s)
    dispatch({ type: 'setSaving', saving: true })
    ipc.claudeConfig.setMcpServers(updated.filter(isEditable))
      .catch(console.error)
      .finally(() => dispatch({ type: 'setSaving', saving: false }))
  }, [state.form, state.servers, state.editingName])

  // Authenticate via OAuth (browser flow)
  const handleAuthenticate = useCallback((server: McpServerEntry) => {
    dispatch({ type: 'startAuth', name: server.name })
    ipc.claudeConfig.authenticateMcpServer(server.name, server.config)
      .then((result) => {
        if (result.success) {
          dispatch({ type: 'authComplete', name: server.name })
          // Re-run health check to refresh status dot
          runHealthCheck()
        } else {
          dispatch({ type: 'authFailed', name: server.name, error: result.error ?? 'Authentication failed' })
        }
      })
      .catch((err) => {
        dispatch({ type: 'authFailed', name: server.name, error: String(err) })
      })
  }, [runHealthCheck])

  // Scroll form into view when opened
  useEffect(() => {
    if (state.editingName !== null) {
      setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50)
    }
  }, [state.editingName])

  const { health, healthChecking } = state
  const formOpen = state.editingName !== null
  const editableServers = state.servers.filter(isEditable)
  const localServers = state.servers.filter((s) => !isEditable(s))
  const hasExternalServers = state.projectServers.length > 0 || state.pluginServers.length > 0
  const totalServers = state.servers.length + state.projectServers.length + state.pluginServers.length

  return (
    <div className="settings-section">
      {/* Header with health check refresh */}
      <div className="settings-mcp-header">
        <div className="settings-field">
          <label className="settings-label">{t('claudeMcp.title')}</label>
          <span className="settings-hint">{t('claudeMcp.hint')}</span>
        </div>
        {totalServers > 0 && (
          <button
            className="btn btn--sm settings-mcp-refresh-btn"
            onClick={runHealthCheck}
            disabled={healthChecking}
            title={t('claudeMcp.checkHealth')}
          >
            {healthChecking ? t('claudeMcp.checking') : t('claudeMcp.checkHealth')}
          </button>
        )}
      </div>

      {/* Empty state - only when ALL lists are empty */}
      {totalServers === 0 && !state.loading && (
        <div className="settings-mcp-empty">
          <p className="settings-mcp-empty-text">{t('claudeMcp.noServers')}</p>
          <span className="settings-mcp-empty-hint">{t('claudeMcp.emptyHint')}</span>
        </div>
      )}

      {/* ── Project MCP servers ─────────────────────────────────────── */}
      {state.projectServers.length > 0 && (
        <div className="settings-mcp-group">
          <div className="settings-mcp-section-header">
            <h4 className="settings-section-subtitle">{t('claudeMcp.sectionProject')}</h4>
            <span className="settings-mcp-section-hint">{t('claudeMcp.projectHint')}</span>
          </div>
          <div className="settings-mcp-list">
            {state.projectServers.map((server) => (
              <ReadOnlyMcpRow
                key={`project:${server.name}`}
                server={server}
                healthStatus={health[server.name]?.status}
                healthError={health[server.name]?.error}
                checking={healthChecking}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Plugin MCP servers ──────────────────────────────────────── */}
      {state.pluginServers.length > 0 && (
        <div className="settings-mcp-group">
          <div className="settings-mcp-section-header">
            <h4 className="settings-section-subtitle">{t('claudeMcp.sectionPlugin')}</h4>
            <span className="settings-mcp-section-hint">{t('claudeMcp.pluginHint')}</span>
          </div>
          <div className="settings-mcp-list">
            {state.pluginServers.map((server) => (
              <ReadOnlyMcpRow
                key={`plugin:${server.name}`}
                server={server}
                healthStatus={health[server.name]?.status}
                healthError={health[server.name]?.error}
                checking={healthChecking}
              />
            ))}
          </div>
        </div>
      )}

      {/* Divider between external and user sections */}
      {hasExternalServers && <div className="settings-divider" />}

      {/* ── User MCP servers (editable) ─────────────────────────────── */}
      {(hasExternalServers || localServers.length > 0) && (
        <div className="settings-mcp-section-header">
          <h4 className="settings-section-subtitle">{t('claudeMcp.sectionUser')}</h4>
        </div>
      )}

      {/* Local overrides (settings.local.json) - read-only */}
      {localServers.length > 0 && (
        <div className="settings-mcp-group">
          <span className="settings-mcp-section-hint">{t('claudeMcp.userLocalHint')}</span>
          <div className="settings-mcp-list">
            {localServers.map((server) => (
              <ReadOnlyMcpRow
                key={`local:${server.name}`}
                server={server}
                healthStatus={health[server.name]?.status}
                healthError={health[server.name]?.error}
                checking={healthChecking}
              />
            ))}
          </div>
        </div>
      )}

      <div className="settings-mcp-list">
        {editableServers.map((server) => {
          const cfg = server.config
          const isPendingDelete = state.pendingDeleteName === server.name
          const serverHealth = health[server.name]

          return (
            <div
              key={server.name}
              className={`settings-mcp-row${server.enabled ? '' : ' settings-mcp-row--disabled'}`}
            >
              <div className="settings-mcp-row-left">
                <McpStatusDot
                  status={server.enabled ? serverHealth?.status : undefined}
                  checking={healthChecking && server.enabled}
                />
                <div className="settings-mcp-info">
                  <div className="settings-mcp-name-row">
                    <span className="settings-mcp-name">{server.name}</span>
                    <span className={`settings-mcp-type-badge settings-mcp-type-badge--${cfg.type ?? 'stdio'}`}>
                      {t(`claudeMcp.typeBadge.${cfg.type ?? 'stdio'}`)}
                    </span>
                    {serverHealth?.status === 'auth_required' && (
                      <span className="settings-mcp-auth-badge">{t('claudeMcp.authNeeded')}</span>
                    )}
                  </div>
                  <span className="settings-mcp-command">{serverPreview(cfg)}</span>
                  {serverHealth?.error && serverHealth.status !== 'ok' && server.enabled && (
                    <span className="settings-mcp-error-hint">{serverHealth.error}</span>
                  )}
                </div>
              </div>
              <div className="settings-mcp-actions">
                {isPendingDelete ? (
                  <div className="settings-mcp-confirm-delete">
                    <span className="settings-mcp-delete-label">{t('claudeMcp.confirmDelete')}</span>
                    <button className="btn btn--sm btn--danger" onClick={() => handleDelete(server.name)}>
                      {t('common:delete')}
                    </button>
                    <button className="btn btn--sm" onClick={() => dispatch({ type: 'cancelDelete' })}>
                      {t('common:cancel')}
                    </button>
                  </div>
                ) : (
                  <>
                    {serverHealth?.status === 'auth_required' && (
                      <button
                        className="btn btn--sm settings-mcp-auth-btn"
                        onClick={() => handleAuthenticate(server)}
                        disabled={state.authenticatingServer === server.name}
                        title={t('claudeMcp.authenticate')}
                      >
                        {state.authenticatingServer === server.name
                          ? t('claudeMcp.authenticating')
                          : t('claudeMcp.authenticate')}
                      </button>
                    )}
                    <button
                      className="settings-mcp-action-btn"
                      onClick={() => dispatch({ type: 'openEdit', server })}
                      title={t('claudeMcp.editServer')}
                    >
                      &#x270E;
                    </button>
                    <button
                      className="settings-mcp-action-btn settings-mcp-action-btn--danger"
                      onClick={() => dispatch({ type: 'confirmDelete', name: server.name })}
                      title={t('common:delete')}
                    >
                      &#x2715;
                    </button>
                  </>
                )}
                <Toggle
                  checked={server.enabled}
                  onChange={() => handleToggle(server.name)}
                />
              </div>
            </div>
          )
        })}
      </div>

      {/* Add button */}
      {!formOpen && (
        <button
          className="btn btn--sm settings-mcp-add-btn"
          onClick={() => dispatch({ type: 'openNew' })}
        >
          + {t('claudeMcp.addServer')}
        </button>
      )}

      {/* Add / Edit form */}
      {formOpen && (
        <McpServerForm
          ref={formRef}
          form={state.form}
          isNew={state.editingName === ''}
          saving={state.saving}
          dispatch={dispatch}
          onSave={handleSave}
        />
      )}
    </div>
  )
}
