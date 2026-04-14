import { useState, useEffect, useCallback, useReducer, useRef, type Reducer } from 'react'
import { useTranslation } from 'react-i18next'
import { FileIcon, DefaultFolderOpenedIcon } from '@react-symbols/icons/utils'
import { Folder } from '@react-symbols/icons/folders'
import type { FileEntry } from '@/types'
import * as ipc from '@/lib/ipc'
import { IconRefresh, IconTreeChevron, IconSearch } from '@/components/shared/icons'
import { useUIStore } from '@/store/ui'
import { DOM_EVENT_FILES_CHANGED } from '@/lib/appBrand'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Props {
  worktreePath: string
  onFileSelect: (filePath: string) => void
}

interface TreeNodeProps {
  entry: FileEntry
  worktreePath: string
  selectedPath: string | null
  onFileSelect: (filePath: string) => void
  onExpand: (dirPath: string) => Promise<FileEntry[]>
}

// ─── TreeNode ────────────────────────────────────────────────────────────────

function TreeNode({ entry, worktreePath, selectedPath, onFileSelect, onExpand }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(false)
  const [children, setChildren] = useState<FileEntry[]>([])

  const handleClick = async () => {
    if (entry.isDirectory) {
      if (!expanded && children.length === 0) {
        const items = await onExpand(entry.path)
        setChildren(items)
      }
      setExpanded(!expanded)
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
        onClick={handleClick}
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
              onFileSelect={onFileSelect}
              onExpand={onExpand}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── FileTree ────────────────────────────────────────────────────────────────

type FileTreeState = { entries: FileEntry[]; selectedPath: string | null; refreshing: boolean; generation: number }
type FileTreeAction =
  | { type: 'LOAD_START' }
  | { type: 'LOAD_DONE'; entries: FileEntry[] }
  | { type: 'LOAD_ERROR' }
  | { type: 'SELECT'; path: string }
  | { type: 'BUMP_GENERATION' }

const fileTreeReducer: Reducer<FileTreeState, FileTreeAction> = (state, action) => {
  switch (action.type) {
    case 'LOAD_START': return { ...state, refreshing: true }
    case 'LOAD_DONE': return { ...state, refreshing: false, entries: action.entries }
    case 'LOAD_ERROR': return { ...state, refreshing: false }
    case 'SELECT': return { ...state, selectedPath: action.path }
    case 'BUMP_GENERATION': return { ...state, generation: state.generation + 1 }
  }
}

export function FileTree({ worktreePath, onFileSelect }: Props) {
  const { t } = useTranslation('right')
  const [ftState, ftDispatch] = useReducer(fileTreeReducer, { entries: [], selectedPath: null, refreshing: false, generation: 0 })
  const { entries, selectedPath, refreshing, generation } = ftState
  const inflightRef = useRef(false)

  const loadRoot = useCallback(() => {
    if (inflightRef.current) return
    inflightRef.current = true
    ftDispatch({ type: 'LOAD_START' })
    ipc.git.getFileTree(worktreePath)
      .then((items: FileEntry[]) => ftDispatch({ type: 'LOAD_DONE', entries: items }))
      .catch((err: unknown) => { console.warn('[FileTree] refresh failed:', err); ftDispatch({ type: 'LOAD_ERROR' }) })
      .finally(() => { inflightRef.current = false })
  }, [worktreePath])

  // Load on mount + worktree change
  useEffect(() => { loadRoot() }, [loadRoot])

  // Auto-refresh when the agent finishes a turn
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ worktreePath: string }>).detail
      if (detail?.worktreePath === worktreePath) {
        loadRoot()
        ftDispatch({ type: 'BUMP_GENERATION' })
      }
    }
    window.addEventListener(DOM_EVENT_FILES_CHANGED, handler)
    return () => window.removeEventListener(DOM_EVENT_FILES_CHANGED, handler)
  }, [worktreePath, loadRoot])

  const handleRefresh = () => {
    loadRoot()
    ftDispatch({ type: 'BUMP_GENERATION' })
  }

  const handleFileSelect = (path: string) => {
    ftDispatch({ type: 'SELECT', path })
    onFileSelect(path)
  }

  const handleExpand = useCallback(
    async (dirPath: string): Promise<FileEntry[]> => {
      const fullPath = `${worktreePath}/${dirPath}`
      const items = await ipc.git.getFileTree(fullPath)
      return items.map((item: FileEntry) => ({
        ...item,
        path: `${dirPath}/${item.name}`
      }))
    },
    [worktreePath]
  )

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
              key={`${entry.path}-${generation}`}
              entry={entry}
              worktreePath={worktreePath}
              selectedPath={selectedPath}
              onFileSelect={handleFileSelect}
              onExpand={handleExpand}
            />
          ))}
        </div>
      )}
    </div>
  )
}
