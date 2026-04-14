import { useReducer, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import * as ipc from '@/lib/ipc'

// ── Types ───────────────────────────────────────��────────────────────────────

interface HookEntry {
  type: string
  command: string
}

interface HookConfig {
  hooks: HookEntry[]
}

const KNOWN_EVENTS = ['Stop', 'Notification', 'PreToolUse', 'PostToolUse']

// ── Reducer ──────────────────────────────────────────────────────────────────

interface State {
  hooks: Record<string, HookConfig[]>
  expanded: Set<string>
  newEventName: string
  loading: boolean
}

type Action =
  | { type: 'setHooks'; hooks: Record<string, HookConfig[]> }
  | { type: 'toggleExpanded'; event: string }
  | { type: 'setNewEventName'; value: string }
  | { type: 'setLoading'; loading: boolean }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'setHooks': return { ...state, hooks: action.hooks }
    case 'toggleExpanded': {
      const next = new Set(state.expanded)
      if (next.has(action.event)) next.delete(action.event)
      else next.add(action.event)
      return { ...state, expanded: next }
    }
    case 'setNewEventName': return { ...state, newEventName: action.value }
    case 'setLoading': return { ...state, loading: action.loading }
  }
}

// ── Component ────────────────────────────────────────────────────────────────

export function SettingsClaudeHooks() {
  const { t } = useTranslation('settings')

  const [state, dispatch] = useReducer(reducer, {
    hooks: {},
    expanded: new Set<string>(),
    newEventName: '',
    loading: true,
  })

  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    dispatch({ type: 'setLoading', loading: true })
    ipc.claudeConfig.getHooks()
      .then((hooks) => dispatch({ type: 'setHooks', hooks }))
      .finally(() => dispatch({ type: 'setLoading', loading: false }))
  }, [])

  const saveHooks = useCallback((hooks: Record<string, HookConfig[]>) => {
    dispatch({ type: 'setHooks', hooks })
    ipc.claudeConfig.setHooks(hooks)
  }, [])

  const addCommand = useCallback((event: string) => {
    const hooks = { ...stateRef.current.hooks }
    const existing = hooks[event] ?? []
    if (existing.length === 0) {
      hooks[event] = [{ hooks: [{ type: 'command', command: '' }] }]
    } else {
      hooks[event] = existing.map((cfg, i) =>
        i === 0 ? { ...cfg, hooks: [...cfg.hooks, { type: 'command', command: '' }] } : cfg
      )
    }
    saveHooks(hooks)
  }, [saveHooks])

  const updateCommand = useCallback((event: string, hookIdx: number, command: string) => {
    const hooks = { ...stateRef.current.hooks }
    const configs = hooks[event]
    if (!configs?.[0]) return
    const updated = configs[0].hooks.map((h, i) =>
      i === hookIdx ? { ...h, command } : h
    )
    hooks[event] = [{ ...configs[0], hooks: updated }, ...configs.slice(1)]
    saveHooks(hooks)
  }, [saveHooks])

  const removeCommand = useCallback((event: string, hookIdx: number) => {
    const hooks = { ...stateRef.current.hooks }
    const configs = hooks[event]
    if (!configs?.[0]) return
    const updated = configs[0].hooks.filter((_, i) => i !== hookIdx)
    if (updated.length === 0) {
      delete hooks[event]
    } else {
      hooks[event] = [{ ...configs[0], hooks: updated }, ...configs.slice(1)]
    }
    saveHooks(hooks)
  }, [saveHooks])

  const addEvent = useCallback(() => {
    const name = stateRef.current.newEventName.trim()
    if (!name || stateRef.current.hooks[name]) return
    const hooks = { ...stateRef.current.hooks, [name]: [{ hooks: [] as HookEntry[] }] }
    saveHooks(hooks)
    dispatch({ type: 'setNewEventName', value: '' })
    // Auto-expand the new event
    dispatch({ type: 'toggleExpanded', event: name })
  }, [saveHooks])

  const eventNames = Object.keys(state.hooks)
  const isEmpty = eventNames.length === 0

  return (
    <div className="settings-section">
      <div className="settings-field">
        <label className="settings-label">{t('claudeHooks.title')}</label>
        <span className="settings-hint">{t('claudeHooks.hint')}</span>
      </div>

      {isEmpty && !state.loading && (
        <p className="settings-empty-state">{t('claudeHooks.noHooks')}</p>
      )}

      {eventNames.map((event) => {
        const configs = state.hooks[event]
        const commands = configs?.[0]?.hooks ?? []
        const isExpanded = state.expanded.has(event)
        const commandCount = commands.length

        return (
          <div key={event} className="settings-hook-card">
            <button
              className="settings-hook-card-header"
              onClick={() => dispatch({ type: 'toggleExpanded', event })}
            >
              <span className="settings-hook-card-chevron" data-expanded={isExpanded}>
                {isExpanded ? '\u25BE' : '\u25B8'}
              </span>
              <span className="settings-hook-card-name">{event}</span>
              {commandCount > 0 && (
                <span className="settings-hook-card-badge">{commandCount}</span>
              )}
            </button>

            {isExpanded && (
              <div className="settings-hook-card-body">
                {commands.length === 0 && (
                  <span className="settings-empty-state">{t('claudeHooks.noCommands')}</span>
                )}
                {commands.map((hook, idx) => (
                  <HookCommandRow
                    key={idx}
                    command={hook.command}
                    placeholder={t('claudeHooks.commandPlaceholder')}
                    onChange={(cmd) => updateCommand(event, idx, cmd)}
                    onRemove={() => removeCommand(event, idx)}
                  />
                ))}
                <button
                  className="settings-hook-add-btn"
                  onClick={() => addCommand(event)}
                >
                  + {t('claudeHooks.addCommand')}
                </button>
              </div>
            )}
          </div>
        )
      })}

      {/* Add new event */}
      <div className="settings-field" style={{ marginTop: 8 }}>
        <span className="settings-section-subtitle">{t('claudeHooks.addEvent')}</span>
        <div className="settings-rule-add-row">
          <select
            className="settings-select"
            value={state.newEventName}
            onChange={(e) => dispatch({ type: 'setNewEventName', value: e.target.value })}
          >
            <option value="">{t('claudeHooks.eventPlaceholder')}</option>
            {KNOWN_EVENTS.filter((e) => !state.hooks[e]).map((e) => (
              <option key={e} value={e}>{e}</option>
            ))}
          </select>
          <input
            className="settings-input"
            type="text"
            value={state.newEventName}
            placeholder={t('claudeHooks.eventPlaceholder')}
            onChange={(e) => dispatch({ type: 'setNewEventName', value: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && addEvent()}
          />
          <button className="btn btn-primary" onClick={addEvent} disabled={!state.newEventName.trim()}>
            +
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Hook Command Row (sub-component) ─────────────────────────────────────────

interface HookCommandRowProps {
  command: string
  placeholder: string
  onChange: (command: string) => void
  onRemove: () => void
}

function HookCommandRow({ command, placeholder, onChange, onRemove }: HookCommandRowProps) {
  const [draft, setDraft] = useReducer(
    (_: string, v: string) => v,
    command
  )

  // Sync draft with prop when it changes externally
  useEffect(() => { setDraft(command) }, [command])

  return (
    <div className="settings-hook-command">
      <input
        className="settings-input settings-hook-command-input"
        type="text"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if (draft !== command) onChange(draft) }}
        onKeyDown={(e) => { if (e.key === 'Enter') onChange(draft) }}
      />
      <button className="settings-hook-command-remove" onClick={onRemove}>
        &times;
      </button>
    </div>
  )
}
