/**
 * SettingsAgents - Manage ACP (Agent Client Protocol) agent configurations.
 *
 * Allows users to add, edit, and remove ACP-compatible agents (e.g. Gemini CLI, Codex).
 * Each agent specifies a command, args, and optional environment variables.
 *
 * Gated behind the `experimentalAcp` feature flag.
 */
import { useEffect, useReducer, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import * as ipc from '@/lib/ipc'
import { Button } from '@/components/ui'

interface AcpAgent {
  id: string
  name: string
  command: string
  args: string[]
  env?: Record<string, string>
}

type Action =
  | { type: 'SET_AGENTS'; agents: AcpAgent[] }
  | { type: 'ADD_AGENT' }
  | { type: 'REMOVE_AGENT'; id: string }
  | { type: 'UPDATE_FIELD'; id: string; field: keyof AcpAgent; value: string }
  | { type: 'SET_EDITING'; id: string | null }
  | { type: 'SET_DIRTY'; dirty: boolean }

interface State {
  agents: AcpAgent[]
  editingId: string | null
  dirty: boolean
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SET_AGENTS':
      return { ...state, agents: action.agents, dirty: false }
    case 'ADD_AGENT': {
      const id = `agent-${Date.now()}`
      return {
        ...state,
        agents: [...state.agents, { id, name: '', command: '', args: [] }],
        editingId: id,
        dirty: true,
      }
    }
    case 'REMOVE_AGENT':
      return {
        ...state,
        agents: state.agents.filter((a) => a.id !== action.id),
        editingId: state.editingId === action.id ? null : state.editingId,
        dirty: true,
      }
    case 'UPDATE_FIELD': {
      const agents = state.agents.map((a) => {
        if (a.id !== action.id) return a
        if (action.field === 'args') {
          return { ...a, args: action.value.split(/\s+/).filter(Boolean) }
        }
        return { ...a, [action.field]: action.value }
      })
      return { ...state, agents, dirty: true }
    }
    case 'SET_EDITING':
      return { ...state, editingId: action.id }
    case 'SET_DIRTY':
      return { ...state, dirty: action.dirty }
    default:
      return state
  }
}

export function SettingsAgents() {
  const { t } = useTranslation('settings')
  const [state, dispatch] = useReducer(reducer, { agents: [], editingId: null, dirty: false })

  useEffect(() => {
    ipc.agent.getAcpAgents().then((agents) => {
      dispatch({ type: 'SET_AGENTS', agents })
    }).catch(() => {})
  }, [])

  const handleSave = useCallback(async () => {
    // Filter out agents with empty name or command
    const valid = state.agents.filter((a) => a.name.trim() && a.command.trim())
    await ipc.agent.saveAcpAgents(valid)
    dispatch({ type: 'SET_AGENTS', agents: valid })
  }, [state.agents])

  const handleAdd = useCallback(() => dispatch({ type: 'ADD_AGENT' }), [])

  return (
    <div className="settings-section">
      <h4 className="settings-section-subtitle">{t('agents.title')}</h4>
      <p className="settings-muted-text">{t('agents.description')}</p>

      <div className="settings-divider" />

      {state.agents.map((agent) => (
        <div key={agent.id} className="settings-card" style={{ marginBottom: 'var(--space-8)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-8)' }}>
            <p className="settings-card-title">{agent.name || t('agents.untitled')}</p>
            <div style={{ display: 'flex', gap: 'var(--space-4)' }}>
              {state.editingId !== agent.id ? (
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => dispatch({ type: 'SET_EDITING', id: agent.id })}
                >
                  {t('agents.edit')}
                </Button>
              ) : (
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => dispatch({ type: 'SET_EDITING', id: null })}
                >
                  {t('agents.collapse')}
                </Button>
              )}
              <Button
                variant="danger"
                size="sm"
                onClick={() => dispatch({ type: 'REMOVE_AGENT', id: agent.id })}
              >
                {t('agents.remove')}
              </Button>
            </div>
          </div>

          {state.editingId === agent.id && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>
              <div className="settings-field">
                <label className="settings-label">{t('agents.name')}</label>
                <input
                  className="settings-input"
                  value={agent.name}
                  onChange={(e) => dispatch({ type: 'UPDATE_FIELD', id: agent.id, field: 'name', value: e.target.value })}
                  placeholder="Gemini CLI"
                />
              </div>

              <div className="settings-field">
                <label className="settings-label">{t('agents.command')}</label>
                <input
                  className="settings-input"
                  value={agent.command}
                  onChange={(e) => dispatch({ type: 'UPDATE_FIELD', id: agent.id, field: 'command', value: e.target.value })}
                  placeholder="gemini"
                />
              </div>

              <div className="settings-field">
                <label className="settings-label">{t('agents.args')}</label>
                <input
                  className="settings-input"
                  value={agent.args.join(' ')}
                  onChange={(e) => dispatch({ type: 'UPDATE_FIELD', id: agent.id, field: 'args', value: e.target.value })}
                  placeholder="--experimental-acp"
                />
              </div>
            </div>
          )}
        </div>
      ))}

      <div style={{ display: 'flex', gap: 'var(--space-8)', marginTop: 'var(--space-8)' }}>
        <Button variant="default" size="sm" onClick={handleAdd}>
          {t('agents.addAgent')}
        </Button>
        {state.dirty && (
          <Button variant="primary" size="sm" onClick={handleSave}>
            {t('agents.save')}
          </Button>
        )}
      </div>
    </div>
  )
}
