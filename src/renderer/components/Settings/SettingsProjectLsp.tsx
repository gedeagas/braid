import { useReducer, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import * as ipc from '@/lib/ipc'
import type { LspServerConfig } from '@/types'
import { Toggle } from '@/components/shared/Toggle'

interface Props {
  projectId: string
  projectPath: string
  lspDisabled: boolean
  lspServers: LspServerConfig[]
  onToggleDisabled: (disabled: boolean) => void
  onUpdateServers: (servers: LspServerConfig[]) => void
}

interface AddForm {
  label: string
  command: string
  args: string
  extensions: string
  languageId: string
  detectFiles: string
}

interface State {
  detectedIds: string[]
  showAddForm: boolean
  form: AddForm
}

type Action =
  | { type: 'setDetected'; ids: string[] }
  | { type: 'toggleAddForm' }
  | { type: 'setFormField'; field: keyof AddForm; value: string }
  | { type: 'resetForm' }

const EMPTY_FORM: AddForm = { label: '', command: '', args: '', extensions: '', languageId: '', detectFiles: '' }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'setDetected': return { ...state, detectedIds: action.ids }
    case 'toggleAddForm': return { ...state, showAddForm: !state.showAddForm, form: EMPTY_FORM }
    case 'setFormField': return { ...state, form: { ...state.form, [action.field]: action.value } }
    case 'resetForm': return { ...state, showAddForm: false, form: EMPTY_FORM }
    default: return state
  }
}

export function SettingsProjectLsp({ projectId: _projectId, projectPath, lspDisabled, lspServers, onToggleDisabled, onUpdateServers }: Props) {
  const { t } = useTranslation('settings')
  const [state, dispatch] = useReducer(reducer, { detectedIds: [], showAddForm: false, form: EMPTY_FORM })

  // Detect built-in servers for this project on mount
  useEffect(() => {
    if (!projectPath) return
    ipc.lsp.detectServers(projectPath, []).then(detected => {
      dispatch({ type: 'setDetected', ids: detected.map(d => d.config.id) })
    }).catch(() => {})
  }, [projectPath])

  const handleAddServer = useCallback(() => {
    const { label, command, args, extensions, languageId, detectFiles } = state.form
    if (!command.trim() || !languageId.trim()) return

    const newServer: LspServerConfig = {
      id: `custom-${Date.now()}`,
      label: label.trim() || command.trim(),
      command: command.trim(),
      args: args.split(' ').map(s => s.trim()).filter(Boolean),
      extensions: extensions.split(',').map(s => s.trim()).filter(Boolean),
      detectFiles: detectFiles.split(',').map(s => s.trim()).filter(Boolean),
      languageId: languageId.trim(),
    }

    onUpdateServers([...lspServers, newServer])
    dispatch({ type: 'resetForm' })
  }, [state.form, lspServers, onUpdateServers])

  const handleRemoveServer = useCallback((id: string) => {
    onUpdateServers(lspServers.filter(s => s.id !== id))
  }, [lspServers, onUpdateServers])

  const setField = useCallback((field: keyof AddForm, value: string) => {
    dispatch({ type: 'setFormField', field, value })
  }, [])

  return (
    <div className="settings-field">
      <div className="settings-lsp-header-row">
        <div>
          <label className="settings-label">{t('project.lspHeader')}</label>
          <span className="settings-hint">{t('project.lspHint')}</span>
        </div>
        <div className="settings-lsp-toggle-group">
          <span className="settings-hint">{t('project.lspDisabled')}</span>
          <Toggle checked={lspDisabled} onChange={onToggleDisabled} />
        </div>
      </div>

      {!lspDisabled && (
        <>
          {/* Auto-detected servers */}
          {state.detectedIds.length > 0 && (
            <div className="lsp-server-list">
              {state.detectedIds.map(id => (
                <div key={id} className="lsp-server-item">
                  <span className="lsp-server-label">{id}</span>
                  <span className="lsp-server-builtin">{t('project.lspDetected')}</span>
                </div>
              ))}
            </div>
          )}

          {/* User custom servers */}
          {lspServers.length > 0 && (
            <div className={`lsp-server-list${state.detectedIds.length > 0 ? ' lsp-server-list--gap' : ''}`}>
              {lspServers.map(server => (
                <div key={server.id} className="lsp-server-item">
                  <span className="lsp-server-label">{server.label}</span>
                  <span className="lsp-server-cmd">{server.command}</span>
                  <button
                    className="settings-lsp-remove-btn"
                    onClick={() => handleRemoveServer(server.id)}
                  >
                    {t('project.lspRemoveServer')}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add server form */}
          {state.showAddForm ? (
            <div className="lsp-add-form">
              {(['label', 'command', 'args', 'extensions', 'languageId', 'detectFiles'] as const).map(field => (
                <div key={field} className="lsp-add-form-field">
                  <span className="lsp-add-form-label">{t(`project.lspServer_${field}`)}</span>
                  <input
                    className="settings-input"
                    value={state.form[field]}
                    onChange={e => setField(field, e.target.value)}
                    placeholder={fieldPlaceholder(field)}
                  />
                </div>
              ))}
              <div className="lsp-add-form-actions">
                <button className="settings-run-cancel-btn" onClick={() => dispatch({ type: 'toggleAddForm' })}>
                  {t('common:cancel', 'Cancel')}
                </button>
                <button
                  className="settings-git-identity-save-btn"
                  onClick={handleAddServer}
                  disabled={!state.form.command.trim() || !state.form.languageId.trim()}
                >
                  {t('project.lspAddServer')}
                </button>
              </div>
            </div>
          ) : (
            <button
              className="settings-copy-files-add"
              onClick={() => dispatch({ type: 'toggleAddForm' })}
            >
              + {t('project.lspAddServer')}
            </button>
          )}
        </>
      )}
    </div>
  )
}

function fieldPlaceholder(field: keyof AddForm): string {
  const map: Record<keyof AddForm, string> = {
    label: 'Svelte',
    command: 'svelteserver',
    args: '--stdio',
    extensions: 'svelte',
    languageId: 'svelte',
    detectFiles: 'svelte.config.js',
  }
  return map[field] ?? ''
}
