import { memo, useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import * as ipc from '@/lib/ipc'
import { useUIStore } from '@/store/ui'
import { useProjectsStore } from '@/store/projects'
import { useTabReorder } from '@/hooks/useTabReorder'
import { useDragScroll } from '@/hooks/useDragScroll'
import type { RunCommand, ScriptSource } from '@/types'

// ─── Stable fallback refs (prevent useShallow infinite loop) ────────────────

const EMPTY_FAVORITES: string[] = []
const EMPTY_COMMANDS: RunCommand[] = []

// ─── Source labels ──────────────────────────────────────────────────────────

const SOURCE_ORDER: ScriptSource[] = ['npm', 'yarn', 'pnpm', 'bun', 'makefile', 'cargo', 'go', 'composer', 'python', 'custom']
const SOURCE_LABELS: Record<ScriptSource, string> = {
  npm: 'npm', yarn: 'yarn', pnpm: 'pnpm', bun: 'bun',
  makefile: 'make', cargo: 'cargo', go: 'go',
  composer: 'composer', python: 'python', custom: 'Custom',
}

function groupBySource(cmds: RunCommand[]): [ScriptSource, RunCommand[]][] {
  const map = new Map<ScriptSource, RunCommand[]>()
  for (const cmd of cmds) {
    const list = map.get(cmd.source) ?? []
    list.push(cmd)
    map.set(cmd.source, list)
  }
  return SOURCE_ORDER.filter((s) => map.has(s)).map((s) => [s, map.get(s)!])
}

/** Build a ghost RunCommand from a stale favorite ID (e.g. "yarn:dev" → name "dev") */
function ghostFromId(id: string): RunCommand {
  const colon = id.indexOf(':')
  const source = colon > 0 ? id.slice(0, colon) : 'custom'
  const name = colon > 0 ? id.slice(colon + 1) : id
  return { id, name, command: id, source: source as ScriptSource }
}

// ─── State ──────────────────────────────────────────────────────────────────

interface State {
  detected: RunCommand[]
  loading: boolean
  filter: string
  addingCustom: boolean
  customName: string
  customCommand: string
}

type Action =
  | { type: 'LOADING' }
  | { type: 'DETECTED'; scripts: RunCommand[] }
  | { type: 'SET_FILTER'; value: string }
  | { type: 'TOGGLE_ADD' }
  | { type: 'SET_CUSTOM_NAME'; value: string }
  | { type: 'SET_CUSTOM_COMMAND'; value: string }
  | { type: 'CLOSE_ADD' }

const initialState: State = {
  detected: [], loading: true, filter: '',
  addingCustom: false, customName: '', customCommand: '',
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'LOADING': return { ...state, loading: true }
    case 'DETECTED': return { ...state, detected: action.scripts, loading: false }
    case 'SET_FILTER': return { ...state, filter: action.value }
    case 'TOGGLE_ADD': return { ...state, addingCustom: !state.addingCustom, customName: '', customCommand: '' }
    case 'SET_CUSTOM_NAME': return { ...state, customName: action.value }
    case 'SET_CUSTOM_COMMAND': return { ...state, customCommand: action.value }
    case 'CLOSE_ADD': return { ...state, addingCustom: false, customName: '', customCommand: '' }
    default: return state
  }
}

// ─── Component ──────────────────────────────────────────────────────────────

interface Props {
  worktreePath: string
  projectPath: string
  projectId: string
  hidden?: boolean
}

export const RunPanel = memo(function RunPanel({ worktreePath, projectPath, projectId, hidden }: Props) {
  const { t } = useTranslation('right')
  const [state, dispatch] = useReducer(reducer, initialState)
  const prevWorktreePath = useRef('')

  // ── Project settings (favorites + custom commands) ──────────────────────
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

  // ── Detect scripts from worktree (branch-specific) ─────────────────────
  const detectFromWorktree = useCallback(() => {
    dispatch({ type: 'LOADING' })
    ipc.scripts.detect(worktreePath).then((scripts) => {
      dispatch({ type: 'DETECTED', scripts })
    }).catch(() => {
      dispatch({ type: 'DETECTED', scripts: [] })
    })
  }, [worktreePath])

  // Re-detect on worktree change or tab activation
  const prevHidden = useRef(hidden)
  useEffect(() => {
    const becameVisible = prevHidden.current && !hidden
    prevHidden.current = hidden
    if (hidden) return
    if (!becameVisible && worktreePath === prevWorktreePath.current) return
    prevWorktreePath.current = worktreePath
    detectFromWorktree()
  }, [worktreePath, hidden, detectFromWorktree])

  // ── Run a command in a new terminal tab ────────────────────────────────
  const runCommand = useCallback((cmd: RunCommand) => {
    useUIStore.getState().setPendingTerminalCommand({
      worktreePath, label: cmd.name, command: cmd.command,
    })
  }, [worktreePath])

  // ── Favorites ─────────────────────────────────────────────────────────
  const favSet = useMemo(() => new Set(favorites), [favorites])

  const toggleFavorite = useCallback((id: string) => {
    const current = useProjectsStore.getState().projects.find((p) => p.id === projectId)?.settings?.runFavorites ?? []
    const next = current.includes(id) ? current.filter((f) => f !== id) : [...current, id]
    updateSettings({ runFavorites: next })
  }, [projectId, updateSettings])

  const reorderFavorites = useCallback((fromIndex: number, toIndex: number) => {
    const current = [...(useProjectsStore.getState().projects.find((p) => p.id === projectId)?.settings?.runFavorites ?? [])]
    const [moved] = current.splice(fromIndex, 1)
    current.splice(toIndex, 0, moved)
    updateSettings({ runFavorites: current })
  }, [projectId, updateSettings])

  const { dragKey, overKey, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd } = useTabReorder(favorites, reorderFavorites)

  // ── Drag-to-scroll for the script list ──────────────────────────────
  const listRef = useRef<HTMLDivElement>(null)
  const { onMouseDown: listMouseDown, preventClickAfterDrag } = useDragScroll(listRef, { axis: 'y' })

  // ── Custom commands (persisted per-project) ───────────────────────────
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

  // ── Build sections: Pinned → Custom → Auto-detected ───────────────────
  const lowerFilter = state.filter.toLowerCase()
  const matchesFilter = (c: RunCommand) =>
    !lowerFilter || c.name.toLowerCase().includes(lowerFilter) || c.command.toLowerCase().includes(lowerFilter)

  // Resolve favorites — show stale ones as ghosts
  const allCommands = new Map<string, RunCommand>()
  for (const c of customCommands) allCommands.set(c.id, c)
  for (const c of state.detected) allCommands.set(c.id, c)

  const favoriteEntries: { cmd: RunCommand; stale: boolean }[] = []
  for (const id of favorites) {
    const resolved = allCommands.get(id)
    const cmd = resolved ?? ghostFromId(id)
    if (matchesFilter(cmd)) {
      favoriteEntries.push({ cmd, stale: !resolved })
    }
  }

  const filteredCustom = customCommands.filter((c) => !favSet.has(c.id) && matchesFilter(c))
  const filteredDetected = state.detected.filter((c) => !favSet.has(c.id) && matchesFilter(c))
  const detectedGrouped = groupBySource(filteredDetected)

  const hasAny = favoriteEntries.length > 0 || filteredCustom.length > 0 || detectedGrouped.length > 0

  // ── Render ────────────────────────────────────────────────────────────
  if (state.loading) {
    return <div className="run-panel"><div className="run-panel-empty"><span className="run-panel-empty-text">{t('loading')}</span></div></div>
  }

  return (
    <div className="run-panel">
      {/* Toolbar */}
      <div className="run-panel-toolbar">
        <input
          className="run-panel-filter" type="text" placeholder={t('runSearch')}
          value={state.filter} onChange={(e) => dispatch({ type: 'SET_FILTER', value: e.target.value })}
        />
        <button className="run-panel-btn" onClick={() => dispatch({ type: 'TOGGLE_ADD' })} title={t('runAddCustom')}>+</button>
        <button className="run-panel-btn" onClick={detectFromWorktree} title={t('runRefresh')}>↻</button>
      </div>

      {/* Add custom form */}
      {state.addingCustom && (
        <div className="run-panel-add-form">
          <input className="run-panel-add-input" placeholder={t('runAddName')} value={state.customName}
            onChange={(e) => dispatch({ type: 'SET_CUSTOM_NAME', value: e.target.value })} autoFocus />
          <input className="run-panel-add-input run-panel-add-cmd" placeholder={t('runAddCommand')} value={state.customCommand}
            onChange={(e) => dispatch({ type: 'SET_CUSTOM_COMMAND', value: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && addCustomCommand()} />
          <button className="run-panel-btn run-panel-add-run" onClick={addCustomCommand}
            disabled={!state.customName.trim() || !state.customCommand.trim()}>▶</button>
          <button className="run-panel-btn" onClick={() => dispatch({ type: 'CLOSE_ADD' })}>✕</button>
        </div>
      )}

      {/* Script list */}
      {!hasAny ? (
        <div className="run-panel-empty">
          <span className="run-panel-empty-text">{t('runEmpty')}</span>
          <span className="run-panel-empty-hint">{t('runEmptyHint')}</span>
        </div>
      ) : (
        <div className="run-panel-list" ref={listRef} onMouseDown={listMouseDown} onClickCapture={preventClickAfterDrag()}>
          {/* Pinned favorites — drag to reorder */}
          {favoriteEntries.length > 0 && (
            <div className="run-panel-group">
              <div className="run-panel-group-header">{t('runFavorites')}</div>
              {favoriteEntries.map(({ cmd, stale }) => (
                <ScriptRow key={cmd.id} cmd={cmd} isFavorite stale={stale} t={t}
                  onRun={runCommand} onToggleFavorite={toggleFavorite}
                  staleBadge={stale ? t('runUnavailable') : undefined}
                  draggable dragKey={dragKey} overKey={overKey}
                  onDragStart={onDragStart} onDragOver={onDragOver}
                  onDragLeave={onDragLeave} onDrop={onDrop} onDragEnd={onDragEnd} />
              ))}
            </div>
          )}

          {/* User-defined custom commands */}
          {filteredCustom.length > 0 && (
            <div className="run-panel-group">
              <div className="run-panel-group-header">{t('runCustom')}</div>
              {filteredCustom.map((cmd) => (
                <ScriptRow key={cmd.id} cmd={cmd} isFavorite={false} isCustom t={t}
                  onRun={runCommand} onToggleFavorite={toggleFavorite} onRemove={removeCustomCommand} />
              ))}
            </div>
          )}

          {/* Auto-detected scripts */}
          {detectedGrouped.map(([source, cmds]) => (
            <div key={source} className="run-panel-group">
              <div className="run-panel-group-header">{SOURCE_LABELS[source]}</div>
              {cmds.map((cmd) => (
                <ScriptRow key={cmd.id} cmd={cmd} isFavorite={false} t={t}
                  onRun={runCommand} onToggleFavorite={toggleFavorite} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
})

// ─── Script row ─────────────────────────────────────────────────────────────

interface ScriptRowProps {
  cmd: RunCommand
  isFavorite: boolean
  isCustom?: boolean
  stale?: boolean
  staleBadge?: string
  draggable?: boolean
  dragKey?: string | null
  overKey?: string | null
  t: (key: string) => string
  onRun: (c: RunCommand) => void
  onToggleFavorite: (id: string) => void
  onRemove?: (id: string) => void
  onDragStart?: (key: string) => (e: React.DragEvent) => void
  onDragOver?: (key: string) => (e: React.DragEvent) => void
  onDragLeave?: (e: React.DragEvent) => void
  onDrop?: (key: string) => (e: React.DragEvent) => void
  onDragEnd?: () => void
}

const ScriptRow = memo(function ScriptRow({
  cmd, isFavorite, isCustom, stale, staleBadge, draggable,
  dragKey, overKey, t, onRun, onToggleFavorite, onRemove,
  onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd,
}: ScriptRowProps) {
  const isDragging = draggable && dragKey === cmd.id
  const isDraggedOver = draggable && overKey === cmd.id && dragKey !== cmd.id

  return (
    <div
      className={`run-panel-row ${stale ? 'run-panel-row--stale' : ''} ${isDragging ? 'run-panel-row--dragging' : ''} ${isDraggedOver ? 'run-panel-row--drag-over' : ''}`}
      draggable={draggable}
      onDragStart={draggable && onDragStart ? onDragStart(cmd.id) : undefined}
      onDragOver={draggable && onDragOver ? onDragOver(cmd.id) : undefined}
      onDragLeave={draggable ? onDragLeave : undefined}
      onDrop={draggable && onDrop ? onDrop(cmd.id) : undefined}
      onDragEnd={draggable ? onDragEnd : undefined}
      onDoubleClick={() => !stale && onRun(cmd)}
    >
      {draggable && (
        <span className="run-panel-grip" title={t('runDragReorder')}>⠿</span>
      )}
      <button
        className={`run-panel-fav ${isFavorite ? 'run-panel-fav--active' : ''}`}
        onClick={() => onToggleFavorite(cmd.id)}
        title={isFavorite ? t('runUnpin') : t('runPin')}
      >
        {isFavorite ? '★' : '☆'}
      </button>
      <div className="run-panel-row-info">
        <div className="run-panel-row-name-line">
          <span className="run-panel-row-name">{cmd.name}</span>
          {staleBadge && <span className="run-panel-row-badge">{staleBadge}</span>}
        </div>
        <span className="run-panel-row-cmd">{cmd.command}</span>
      </div>
      {isCustom && onRemove && (
        <button className="run-panel-remove" onClick={() => onRemove(cmd.id)} title={t('runRemove')}>✕</button>
      )}
      {!stale && (
        <button className="run-panel-play" onClick={() => onRun(cmd)} title={t('runRun')}>▶</button>
      )}
    </div>
  )
})
