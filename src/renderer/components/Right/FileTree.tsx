import { useEffect, useCallback, useMemo, useReducer, useRef, type Reducer } from 'react'
import { useTranslation } from 'react-i18next'
import { FileIcon, DefaultFolderOpenedIcon } from '@react-symbols/icons/utils'
import { Folder } from '@react-symbols/icons/folders'
import type { FileEntry } from '@/types'
import * as ipc from '@/lib/ipc'
import { FILE_PATH_MIME } from '@/lib/fileDragMime'
import { IconRefresh, IconTreeChevron, IconSearch } from '@/components/shared/icons'
import { ContextMenu, type ContextMenuItem } from '@/components/shared/ContextMenu'
import { loadStr } from '@/store/ui/helpers'
import { SK } from '@/lib/storageKeys'
import { useUIStore } from '@/store/ui'
import { requestWorktreeRefresh, subscribeWorktreeRefresh } from '@/lib/worktreeRefresh'

type InstalledApp = { id: string; name: string; icon: string | null }

// Module-level cache shared across FileTree instances - avoids redundant IPC
let appsCached = false

// ─── Types ───────────────────────────────────────────────────────────────────

interface Props {
  worktreePath: string
  onFileSelect: (filePath: string) => void
}

interface TreeNodeProps {
  entry: FileEntry
  worktreePath: string
  selectedPath: string | null
  expandedPaths: Set<string>
  childrenByPath: Record<string, FileEntry[]>
  onFileSelect: (filePath: string) => void
  onToggleDirectory: (dirPath: string) => void
  onContextMenu: (e: React.MouseEvent, fullPath: string, isDirectory: boolean) => void
}

// ─── TreeNode ────────────────────────────────────────────────────────────────

function TreeNode({
  entry,
  worktreePath,
  selectedPath,
  expandedPaths,
  childrenByPath,
  onFileSelect,
  onToggleDirectory,
  onContextMenu
}: TreeNodeProps) {
  const expanded = expandedPaths.has(entry.path)
  const children = childrenByPath[entry.path] ?? []
  const handleClick = () => {
    if (entry.isDirectory) {
      onToggleDirectory(entry.path)
    } else {
      onFileSelect(`${worktreePath}/${entry.path}`)
    }
  }

  const fullPath = `${worktreePath}/${entry.path}`
  const isSelected = selectedPath === fullPath

  return (
    <div>
      <div
        className={`file-entry ${isSelected ? 'selected' : ''}`}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(FILE_PATH_MIME, fullPath)
          e.dataTransfer.effectAllowed = 'copy'
        }}
        onClick={handleClick}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenu(e, fullPath, entry.isDirectory) }}
      >
        {entry.isDirectory && (
          <span className="file-chevron">
            <IconTreeChevron open={expanded} />
          </span>
        )}
        <span className="file-icon">
          {entry.isDirectory
            ? (expanded
                ? <DefaultFolderOpenedIcon width={18} height={18} />
                : <Folder width={18} height={18} />)
            : <FileIcon fileName={entry.name} autoAssign width={18} height={18} />}
        </span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {entry.name}
        </span>
      </div>
      {expanded && children.length > 0 && (
        <div className="file-children">
          {children.map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              worktreePath={worktreePath}
              selectedPath={selectedPath}
              expandedPaths={expandedPaths}
              childrenByPath={childrenByPath}
              onFileSelect={onFileSelect}
              onToggleDirectory={onToggleDirectory}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── FileTree ────────────────────────────────────────────────────────────────

type FileTreeState = {
  entries: FileEntry[]
  expandedPaths: Set<string>
  childrenByPath: Record<string, FileEntry[]>
  selectedPath: string | null
  refreshing: boolean
  menu: { x: number; y: number; path: string; isDirectory: boolean } | null
  apps: InstalledApp[]
}

const createInitialFileTreeState = (): FileTreeState => ({
  entries: [],
  expandedPaths: new Set<string>(),
  childrenByPath: {},
  selectedPath: null,
  refreshing: false,
  menu: null,
  apps: [],
})

type FileTreeAction =
  | { type: 'RESET_FOR_WORKTREE' }
  | { type: 'LOAD_START' }
  | { type: 'LOAD_DONE'; entries: FileEntry[] | null | undefined }
  | { type: 'LOAD_ERROR' }
  | { type: 'TOGGLE_DIRECTORY'; path: string }
  | { type: 'SET_CHILDREN'; path: string; children: FileEntry[] }
  | { type: 'SET_CHILDREN_MANY'; entries: Record<string, FileEntry[]> }
  | { type: 'SELECT'; path: string }
  | { type: 'OPEN_MENU'; x: number; y: number; path: string; isDirectory: boolean }
  | { type: 'CLOSE_MENU' }
  | { type: 'SET_APPS'; apps: InstalledApp[] }

const fileTreeReducer: Reducer<FileTreeState, FileTreeAction> = (state, action) => {
  switch (action.type) {
    case 'RESET_FOR_WORKTREE': return { ...createInitialFileTreeState(), apps: state.apps }
    case 'LOAD_START': return { ...state, refreshing: true }
    case 'LOAD_DONE': return { ...state, refreshing: false, entries: action.entries ?? [] }
    case 'LOAD_ERROR': return { ...state, refreshing: false }
    case 'TOGGLE_DIRECTORY': {
      const expandedPaths = new Set(state.expandedPaths)
      if (expandedPaths.has(action.path)) expandedPaths.delete(action.path)
      else expandedPaths.add(action.path)
      return { ...state, expandedPaths }
    }
    case 'SET_CHILDREN': return { ...state, childrenByPath: { ...state.childrenByPath, [action.path]: action.children } }
    case 'SET_CHILDREN_MANY': return { ...state, childrenByPath: { ...state.childrenByPath, ...action.entries } }
    case 'SELECT': return { ...state, selectedPath: action.path }
    case 'OPEN_MENU': return { ...state, menu: { x: action.x, y: action.y, path: action.path, isDirectory: action.isDirectory } }
    case 'CLOSE_MENU': return { ...state, menu: null }
    case 'SET_APPS': return { ...state, apps: action.apps }
  }
}

export function FileTree({ worktreePath, onFileSelect }: Props) {
  const { t } = useTranslation('right')
  const [ftState, ftDispatch] = useReducer(fileTreeReducer, createInitialFileTreeState())
  const { entries, expandedPaths, childrenByPath, selectedPath, refreshing, menu, apps } = ftState
  const expandedPathsRef = useRef(expandedPaths)
  const childrenByPathRef = useRef(childrenByPath)
  const rootLoadIdRef = useRef(0)
  const worktreePathRef = useRef(worktreePath)

  useEffect(() => {
    expandedPathsRef.current = expandedPaths
  }, [expandedPaths])

  useEffect(() => {
    childrenByPathRef.current = childrenByPath
  }, [childrenByPath])

  useEffect(() => {
    worktreePathRef.current = worktreePath
  }, [worktreePath])

  const loadDirectory = useCallback(
    async (dirPath: string, forceRefresh = false): Promise<FileEntry[]> => {
      const fullPath = `${worktreePath}/${dirPath}`
      const items = await ipc.git.getFileTree(fullPath, forceRefresh)
      return (items ?? []).map((item: FileEntry) => ({
        ...item,
        path: `${dirPath}/${item.name}`
      }))
    },
    [worktreePath]
  )

  const loadRoot = useCallback((forceRefresh = false, refreshExpanded = false) => {
    const loadId = rootLoadIdRef.current + 1
    rootLoadIdRef.current = loadId
    ftDispatch({ type: 'LOAD_START' })
    ipc.git.getFileTree(worktreePath, forceRefresh)
      .then(async (items: FileEntry[]) => {
        if (rootLoadIdRef.current !== loadId || worktreePathRef.current !== worktreePath) return
        ftDispatch({ type: 'LOAD_DONE', entries: items })

        if (!refreshExpanded || expandedPathsRef.current.size === 0) return
        const expandedEntries = await Promise.all(
          [...expandedPathsRef.current].map(async (dirPath) => {
            try {
              return [dirPath, await loadDirectory(dirPath, forceRefresh)] as const
            } catch (err) {
              console.warn('[FileTree] expanded folder refresh failed:', dirPath, err)
              return null
            }
          })
        )
        if (rootLoadIdRef.current !== loadId || worktreePathRef.current !== worktreePath) return
        const refreshedChildren = Object.fromEntries(expandedEntries.filter((entry): entry is readonly [string, FileEntry[]] => entry !== null))
        ftDispatch({ type: 'SET_CHILDREN_MANY', entries: refreshedChildren })
      })
      .catch((err: unknown) => {
        if (rootLoadIdRef.current !== loadId || worktreePathRef.current !== worktreePath) return
        console.warn('[FileTree] refresh failed:', err)
        ftDispatch({ type: 'LOAD_ERROR' })
      })
  }, [loadDirectory, worktreePath])

  // Load on mount + worktree change
  useEffect(() => {
    ftDispatch({ type: 'RESET_FOR_WORKTREE' })
    expandedPathsRef.current = new Set()
    loadRoot()
  }, [loadRoot])

  // Auto-refresh when a per-worktree refresh is requested.
  useEffect(() => {
    return subscribeWorktreeRefresh(worktreePath, 'files', (event) => {
      loadRoot(event.force, true)
    })
  }, [worktreePath, loadRoot])

  const handleRefresh = () => {
    requestWorktreeRefresh(worktreePath, 'files', { reason: 'manual', force: true })
  }

  const handleFileSelect = (path: string) => {
    ftDispatch({ type: 'SELECT', path })
    onFileSelect(path)
  }

  const handleToggleDirectory = useCallback((dirPath: string) => {
    const requestWorktreePath = worktreePath
    const requestLoadId = rootLoadIdRef.current
    const willExpand = !expandedPathsRef.current.has(dirPath)
    const nextExpandedPaths = new Set(expandedPathsRef.current)
    if (willExpand) nextExpandedPaths.add(dirPath)
    else nextExpandedPaths.delete(dirPath)
    expandedPathsRef.current = nextExpandedPaths

    ftDispatch({ type: 'TOGGLE_DIRECTORY', path: dirPath })
    if (willExpand && !childrenByPathRef.current[dirPath]) {
      loadDirectory(dirPath)
        .then((children) => {
          if (rootLoadIdRef.current !== requestLoadId || worktreePathRef.current !== requestWorktreePath) return
          ftDispatch({ type: 'SET_CHILDREN', path: dirPath, children })
        })
        .catch((err: unknown) => console.warn('[FileTree] folder expand failed:', err))
    }
  }, [loadDirectory, worktreePath])

  // Lazily fetch installed apps on first context menu open
  useEffect(() => {
    if (!menu || appsCached) return
    appsCached = true
    ipc.shell.getInstalledApps().then((result: InstalledApp[]) => {
      ftDispatch({ type: 'SET_APPS', apps: result })
    })
  }, [menu])

  const handleContextMenu = useCallback((e: React.MouseEvent, fullPath: string, isDirectory: boolean) => {
    ftDispatch({ type: 'OPEN_MENU', x: e.clientX, y: e.clientY, path: fullPath, isDirectory })
  }, [])

  const menuItems = useMemo((): ContextMenuItem[] => {
    if (!menu) return []
    const items: ContextMenuItem[] = []
    const lastAppId = loadStr(SK.lastOpenInApp, '')
    const lastApp = apps.find((a) => a.id === lastAppId)
    if (lastApp) {
      items.push({ label: t('openInApp', { app: lastApp.name }), onClick: () => ipc.shell.openInApp(lastApp.id, menu.path) })
    }
    const revealLabel = ipc.shell.platform === 'linux'
      ? t('revealInFileManager')
      : t('revealInFinder')
    items.push({ label: revealLabel, onClick: () => ipc.shell.openInApp('finder', menu.path) })
    items.push({ label: '---', onClick: () => {} })
    items.push({ label: t('copyPath'), onClick: () => navigator.clipboard.writeText(menu.path) })
    return items
  }, [menu, apps, t])

  return (
    <div className="file-tree">
      <div className="panel-toolbar">
        <span className="panel-toolbar-label">
          {entries.length > 0 && t('fileCount', { count: entries.length })}
        </span>
        <button
          className="panel-refresh-btn"
          onClick={() => useUIStore.getState().openQuickOpen()}
          title={t('quickOpen')}
          aria-label={t('quickOpen')}
        >
          <IconSearch size={13} />
        </button>
        <button
          className={`panel-refresh-btn${refreshing ? ' refreshing' : ''}`}
          onClick={handleRefresh}
          disabled={refreshing}
        >
          <IconRefresh />
          {t('refresh', { ns: 'common' })}
        </button>
      </div>
      {refreshing && entries.length === 0 ? (
        <div className="file-tree-skeleton">
          {Array.from({ length: 8 }, (_, i) => (
            <div
              key={i}
              className="file-tree-skeleton-row"
              style={{ width: `${55 + (i * 17) % 35}%` }}
            />
          ))}
        </div>
      ) : (
        <div className={`file-tree-body${refreshing ? ' refreshing' : ''}`}>
          {entries.map((entry) => (
            <TreeNode
              key={entry.path}
              entry={entry}
              worktreePath={worktreePath}
              selectedPath={selectedPath}
              expandedPaths={expandedPaths}
              childrenByPath={childrenByPath}
              onFileSelect={handleFileSelect}
              onToggleDirectory={handleToggleDirectory}
              onContextMenu={handleContextMenu}
            />
          ))}
        </div>
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onClose={() => ftDispatch({ type: 'CLOSE_MENU' })}
        />
      )}
    </div>
  )
}
