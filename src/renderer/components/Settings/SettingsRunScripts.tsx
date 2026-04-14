import { useReducer, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useProjectsStore } from '@/store/projects'
import { useTabReorder } from '@/hooks/useTabReorder'
import type { RunCommand } from '@/types'

// ─── Stable fallback refs (prevent useShallow infinite loop) ────────────────

const EMPTY_FAVORITES: string[] = []
const EMPTY_COMMANDS: RunCommand[] = []

// ─── State ──────────────────────────────────────────────────────────────────

interface State {
  addingCustom: boolean
  customName: string
  customCommand: string
  editingId: string | null
  editName: string
  editCommand: string
}

type Action =
  | { type: 'TOGGLE_ADD' }
  | { type: 'CLOSE_ADD' }
  | { type: 'SET_CUSTOM_NAME'; value: string }
  | { type: 'SET_CUSTOM_COMMAND'; value: string }
  | { type: 'START_EDIT'; id: string; name: string; command: string }
  | { type: 'SET_EDIT_NAME'; value: string }
  | { type: 'SET_EDIT_COMMAND'; value: string }
  | { type: 'CLOSE_EDIT' }

const initialState: State = {
  addingCustom: false, customName: '', customCommand: '',
  editingId: null, editName: '', editCommand: '',
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'TOGGLE_ADD': return { ...state, addingCustom: !state.addingCustom, customName: '', customCommand: '', editingId: null, editName: '', editCommand: '' }
    case 'CLOSE_ADD': return { ...state, addingCustom: false, customName: '', customCommand: '' }
    case 'SET_CUSTOM_NAME': return { ...state, customName: action.value }
    case 'SET_CUSTOM_COMMAND': return { ...state, customCommand: action.value }
    case 'START_EDIT': return { ...state, editingId: action.id, editName: action.name, editCommand: action.command, addingCustom: false, customName: '', customCommand: '' }
    case 'SET_EDIT_NAME': return { ...state, editName: action.value }
    case 'SET_EDIT_COMMAND': return { ...state, editCommand: action.value }
    case 'CLOSE_EDIT': return { ...state, editingId: null, editName: '', editCommand: '' }
    default: return state
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build a fallback command string based on the source runner */
function buildFallbackCommand(source: string, name: string): string {
  switch (source) {
    case 'npm': case 'yarn': case 'pnpm': case 'bun': return `${source} run ${name}`
    case 'makefile': return `make ${name}`
    case 'cargo': return `cargo ${name}`
    case 'go': return `go ${name}`
    case 'composer': return `composer run ${name}`
    case 'python': return name
    default: return `${source} ${name}`
  }
}

/** Resolve a favorite ID to a display name + source badge, checking custom commands first */
function resolveFavorite(id: string, customMap: Map<string, RunCommand>): { name: string; source: string; command: string } {
  const custom = customMap.get(id)
  if (custom) return { name: custom.name, source: 'custom', command: custom.command }
  const colon = id.indexOf(':')
  const source = colon > 0 ? id.slice(0, colon) : '?'
  const name = colon > 0 ? id.slice(colon + 1) : id
  return { name, source, command: buildFallbackCommand(source, name) }
}

// ─── Component ──────────────────────────────────────────────────────────────

interface Props {
  projectId: string
}

export function SettingsRunScripts({ projectId }: Props) {
  const { t } = useTranslation('settings')
  const [state, dispatch] = useReducer(reducer, initialState)

  const { favorites, customCommands } = useProjectsStore(useShallow((s) => {
    const project = s.projects.find((p) => p.id === projectId)
    return {
      favorites: project?.settings?.runFavorites ?? EMPTY_FAVORITES,
      customCommands: project?.settings?.runCustomCommands ?? EMPTY_COMMANDS,
    }
  }))

  const updateSettings = useCallback(
    (partial: { runFavorites?: string[]; runCustomCommands?: RunCommand[] }) =>
      useProjectsStore.getState().updateProjectSettings(projectId, partial),
    [projectId],
  )

  // ── Lookup maps ────────────────────────────────────────────────────────
  const customMap = useMemo(() => {
    const m = new Map<string, RunCommand>()
    for (const c of customCommands) m.set(c.id, c)
    return m
  }, [customCommands])

  const favSet = useMemo(() => new Set(favorites), [favorites])

  const removeFavorite = useCallback((id: string) => {
    const current = useProjectsStore.getState().projects.find((p) => p.id === projectId)?.settings?.runFavorites ?? []
    updateSettings({ runFavorites: current.filter((f) => f !== id) })
  }, [projectId, updateSettings])

  const reorderFavorites = useCallback((fromIndex: number, toIndex: number) => {
    const current = [...(useProjectsStore.getState().projects.find((p) => p.id === projectId)?.settings?.runFavorites ?? [])]
    const [moved] = current.splice(fromIndex, 1)
    current.splice(toIndex, 0, moved)
    updateSettings({ runFavorites: current })
  }, [projectId, updateSettings])

  const { dragKey, overKey, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd } = useTabReorder(favorites, reorderFavorites)

  // ── Custom commands ───────────────────────────────────────────────────
  const addCustomCommand = useCallback(() => {
    const name = state.customName.trim()
    const command = state.customCommand.trim()
    if (!name || !command) return
    const newCmd: RunCommand = { id: `custom:${crypto.randomUUID()}`, name, command, source: 'custom' }
    const current = useProjectsStore.getState().projects.find((p) => p.id === projectId)?.settings?.runCustomCommands ?? []
    updateSettings({ runCustomCommands: [...current, newCmd] })
    dispatch({ type: 'CLOSE_ADD' })
  }, [state.customName, state.customCommand, projectId, updateSettings])

  const removeCustomCommand = useCallback((id: string) => {
    const project = useProjectsStore.getState().projects.find((p) => p.id === projectId)
    const cmds = project?.settings?.runCustomCommands ?? []
    const favs = project?.settings?.runFavorites ?? []
    updateSettings({
      runCustomCommands: cmds.filter((c) => c.id !== id),
      ...(favs.includes(id) ? { runFavorites: favs.filter((f) => f !== id) } : {}),
    })
  }, [projectId, updateSettings])

  const commitEdit = useCallback(() => {
    if (!state.editingId) return
    const name = state.editName.trim()
    const command = state.editCommand.trim()
    if (!name || !command) return
    const current = useProjectsStore.getState().projects.find((p) => p.id === projectId)?.settings?.runCustomCommands ?? []
    updateSettings({
      runCustomCommands: current.map((c) => c.id === state.editingId ? { ...c, name, command } : c),
    })
    dispatch({ type: 'CLOSE_EDIT' })
  }, [state.editingId, state.editName, state.editCommand, projectId, updateSettings])

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="settings-card">
      <h3 className="settings-card-title">{t('project.runScriptsHeader')}</h3>
      <span className="settings-hint">{t('project.runScriptsSettingsHint')}</span>

      {/* Pinned Favorites */}
      <div className="settings-field">
        <label className="settings-label">{t('project.pinnedFavorites')}</label>
        {favorites.length === 0 ? (
          <span className="settings-run-empty">{t('project.noPinnedFavorites')}</span>
        ) : (
          <div className="settings-run-list">
            {favorites.map((id) => {
              const resolved = resolveFavorite(id, customMap)
              return (
                <div
                  key={id}
                  className={`settings-run-item${dragKey === id ? ' settings-run-item--dragging' : ''}${overKey === id && dragKey !== id ? ' settings-run-item--drag-over' : ''}`}
                  draggable
                  onDragStart={onDragStart(id)}
                  onDragOver={onDragOver(id)}
                  onDragLeave={onDragLeave}
                  onDrop={onDrop(id)}
                  onDragEnd={onDragEnd}
                >
                  <span className="settings-run-grip" title={t('project.dragReorder')}>⠿</span>
                  <div className="settings-run-item-info">
                    <div className="settings-run-item-name-line">
                      <span className="settings-run-item-label">{resolved.name}</span>
                      <span className="settings-run-badge">{resolved.source}</span>
                    </div>
                    <span className="settings-run-item-cmd">{resolved.command}</span>
                  </div>
                  <button
                    className="settings-run-item-remove"
                    onClick={() => removeFavorite(id)}
                    title={t('project.unpin')}
                  >✕</button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Custom Commands */}
      <div className="settings-field">
        <label className="settings-label">{t('project.customCommands')}</label>
        {customCommands.length === 0 && !state.addingCustom ? (
          <span className="settings-run-empty">{t('project.noCustomCommands')}</span>
        ) : (
          <div className="settings-run-list">
            {customCommands.map((cmd) => (
              <div key={cmd.id} className="settings-run-item">
                {state.editingId === cmd.id ? (
                  <div className="settings-run-edit-row">
                    <input
                      className="settings-run-edit-input"
                      value={state.editName}
                      onChange={(e) => dispatch({ type: 'SET_EDIT_NAME', value: e.target.value })}
                      placeholder={t('project.commandName')}
                      autoFocus
                      onKeyDown={(e) => { if (e.key === 'Escape') dispatch({ type: 'CLOSE_EDIT' }) }}
                    />
                    <input
                      className="settings-run-edit-input settings-run-edit-cmd"
                      value={state.editCommand}
                      onChange={(e) => dispatch({ type: 'SET_EDIT_COMMAND', value: e.target.value })}
                      placeholder={t('project.commandValue')}
                      onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); else if (e.key === 'Escape') dispatch({ type: 'CLOSE_EDIT' }) }}
                    />
                    <button className="settings-run-save-btn" onClick={commitEdit}
                      disabled={!state.editName.trim() || !state.editCommand.trim()}>
                      {t('project.save')}
                    </button>
                    <button className="settings-run-cancel-btn" onClick={() => dispatch({ type: 'CLOSE_EDIT' })}>
                      {t('project.cancelEdit')}
                    </button>
                  </div>
                ) : (
                  <>
                    {favSet.has(cmd.id) && <span className="settings-run-star">★</span>}
                    <div className="settings-run-item-info">
                      <span className="settings-run-item-label">{cmd.name}</span>
                      <span className="settings-run-item-cmd">{cmd.command}</span>
                    </div>
                    <button
                      className="settings-run-item-action"
                      onClick={() => dispatch({ type: 'START_EDIT', id: cmd.id, name: cmd.name, command: cmd.command })}
                      title={t('project.editCommand')}
                    >✎</button>
                    <button
                      className="settings-run-item-remove"
                      onClick={() => removeCustomCommand(cmd.id)}
                      title={t('project.removeCommand')}
                    >✕</button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Add custom command form */}
        {state.addingCustom ? (
          <div className="settings-run-add-form">
            <input
              className="settings-run-add-input"
              value={state.customName}
              onChange={(e) => dispatch({ type: 'SET_CUSTOM_NAME', value: e.target.value })}
              placeholder={t('project.commandName')}
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Escape') dispatch({ type: 'CLOSE_ADD' }) }}
            />
            <input
              className="settings-run-add-input settings-run-add-cmd"
              value={state.customCommand}
              onChange={(e) => dispatch({ type: 'SET_CUSTOM_COMMAND', value: e.target.value })}
              placeholder={t('project.commandValue')}
              onKeyDown={(e) => { if (e.key === 'Enter') addCustomCommand(); else if (e.key === 'Escape') dispatch({ type: 'CLOSE_ADD' }) }}
            />
            <button className="settings-run-save-btn" onClick={addCustomCommand}
              disabled={!state.customName.trim() || !state.customCommand.trim()}>
              {t('project.addButton')}
            </button>
            <button className="settings-run-cancel-btn" onClick={() => dispatch({ type: 'CLOSE_ADD' })}>
              {t('project.cancelEdit')}
            </button>
          </div>
        ) : (
          <button className="settings-copy-files-add" onClick={() => dispatch({ type: 'TOGGLE_ADD' })}>
            + {t('project.addCommand')}
          </button>
        )}
      </div>
    </div>
  )
}
