import { forwardRef, type Dispatch } from 'react'
import { useTranslation } from 'react-i18next'
import type { Action, FormState, ServerType } from './mcpReducer'
import { KvPairRows } from './KvPairRows'

interface McpServerFormProps {
  form: FormState
  isNew: boolean
  saving: boolean
  dispatch: Dispatch<Action>
  onSave: () => void
}

export const McpServerForm = forwardRef<HTMLDivElement, McpServerFormProps>(
  function McpServerForm({ form, isNew, saving, dispatch, onSave }, ref) {
    const { t } = useTranslation('settings')
    const isRemote = form.type === 'sse' || form.type === 'http'

    return (
      <div className="settings-mcp-form" ref={ref}>
        <span className="settings-label">
          {isNew ? t('claudeMcp.addServer') : t('claudeMcp.editServer')}
        </span>

        {/* Server Name */}
        <div className="settings-field">
          <label className="settings-sublabel">{t('claudeMcp.serverName')}</label>
          <input
            className={`settings-input${form.nameError ? ' settings-input--error' : ''}`}
            value={form.name}
            placeholder="e.g. filesystem"
            onChange={(e) => dispatch({ type: 'setFormField', field: 'name', value: e.target.value })}
            disabled={!isNew}
          />
          {form.nameError && <span className="settings-error-hint">{form.nameError}</span>}
        </div>

        {/* Type selector */}
        <div className="settings-field">
          <label className="settings-sublabel">{t('claudeMcp.serverType')}</label>
          <div className="settings-mcp-type-tabs">
            {(['stdio', 'sse', 'http'] as ServerType[]).map((tp) => (
              <button
                key={tp}
                className={`settings-mcp-type-tab${form.type === tp ? ' settings-mcp-type-tab--active' : ''}`}
                onClick={() => dispatch({ type: 'setFormField', field: 'type', value: tp })}
              >
                {tp.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* stdio fields */}
        {form.type === 'stdio' && (
          <>
            <div className="settings-mcp-npm-row">
              <span className="settings-mcp-npm-label">{t('claudeMcp.npmQuickAdd')}</span>
              <input
                className="settings-input settings-mcp-npm-input"
                value={form.npmPackage}
                placeholder={t('claudeMcp.npmPackage')}
                onChange={(e) => dispatch({ type: 'setFormField', field: 'npmPackage', value: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') dispatch({ type: 'fillNpm' }) }}
              />
              <button
                className="btn btn--sm"
                onClick={() => dispatch({ type: 'fillNpm' })}
                disabled={!form.npmPackage.trim()}
              >
                {t('claudeMcp.npmFill')}
              </button>
            </div>

            <div className="settings-field">
              <label className="settings-sublabel">{t('claudeMcp.command')}</label>
              <input
                className={`settings-input${form.commandError ? ' settings-input--error' : ''}`}
                value={form.command}
                placeholder="npx"
                onChange={(e) => dispatch({ type: 'setFormField', field: 'command', value: e.target.value })}
              />
              {form.commandError && <span className="settings-error-hint">{form.commandError}</span>}
            </div>

            <div className="settings-field">
              <label className="settings-sublabel">{t('claudeMcp.args')}</label>
              <input
                className="settings-input"
                value={form.args}
                placeholder="-y @modelcontextprotocol/server-filesystem /path"
                onChange={(e) => dispatch({ type: 'setFormField', field: 'args', value: e.target.value })}
              />
            </div>

            <div className="settings-field">
              <label className="settings-sublabel">{t('claudeMcp.envVars')}</label>
              <KvPairRows
                pairs={form.envPairs}
                onChange={(i, k, v) => dispatch({ type: 'setEnvPair', index: i, key: k, value: v })}
                onAdd={() => dispatch({ type: 'addEnvPair' })}
                onRemove={(i) => dispatch({ type: 'removeEnvPair', index: i })}
                keyPlaceholder="KEY"
                valuePlaceholder="value"
              />
            </div>
          </>
        )}

        {/* SSE / HTTP fields */}
        {isRemote && (
          <>
            <div className="settings-field">
              <label className="settings-sublabel">{t('claudeMcp.url')}</label>
              <input
                className={`settings-input${form.urlError ? ' settings-input--error' : ''}`}
                value={form.url}
                placeholder="https://example.com/mcp"
                onChange={(e) => dispatch({ type: 'setFormField', field: 'url', value: e.target.value })}
              />
              {form.urlError && <span className="settings-error-hint">{form.urlError}</span>}
            </div>

            <div className="settings-field">
              <label className="settings-sublabel">{t('claudeMcp.headers')}</label>
              <KvPairRows
                pairs={form.headerPairs}
                onChange={(i, k, v) => dispatch({ type: 'setHeaderPair', index: i, key: k, value: v })}
                onAdd={() => dispatch({ type: 'addHeaderPair' })}
                onRemove={(i) => dispatch({ type: 'removeHeaderPair', index: i })}
                keyPlaceholder="Header-Name"
                valuePlaceholder="value"
              />
            </div>

            <div className="settings-mcp-auth-hint-box">
              <span className="settings-mcp-auth-hint-text">{t('claudeMcp.authHint')}</span>
            </div>
          </>
        )}

        {/* Form actions */}
        <div className="settings-mcp-form-actions">
          <button
            className="btn btn--sm btn--primary"
            onClick={onSave}
            disabled={saving}
          >
            {t('claudeMcp.save')}
          </button>
          <button
            className="btn btn--sm"
            onClick={() => dispatch({ type: 'closeForm' })}
          >
            {t('claudeMcp.cancel')}
          </button>
        </div>
      </div>
    )
  },
)
